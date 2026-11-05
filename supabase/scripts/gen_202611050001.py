"""Genera supabase/migrations/202611050001_puestos_exportar_prendas.sql.

Parte de las definiciones VIGENTES de cada función en la base local (pgtest, ya con todas las migraciones anteriores),
aplica reemplazos verificados (cada uno debe coincidir exactamente N veces) y escribe el SQL final.
Uso: python supabase/scripts/gen_202611050001.py   (con el clúster local arriba: bash supabase/scripts/pg-local/rebuild.sh)
"""
import io, subprocess, sys

PSQL = ["psql", "-h", "localhost", "-p", "55432", "-U", "postgres", "-d", "pgtest", "-At", "-c"]


def defn(sig):
    out = subprocess.run(PSQL + ["select pg_get_functiondef('%s'::regprocedure)" % sig], capture_output=True, check=True).stdout.decode("utf8").replace(chr(13), "")
    return out.strip()


def sub(text, old, new, count=1):
    n = text.count(old)
    if n != count:
        sys.exit("NO COINCIDE (%d veces, esperaba %d): %r" % (n, count, old[:140]))
    return text.replace(old, new)


def semi(t):
    return t.rstrip() + ";\n"


out = []
add = out.append

add("""-- Prendas por puesto (solo para clientes que lo activan, p. ej. BCR) y exportación de prendas.
-- Aplicar después de 202610110001. UNA sola ejecución (todo en una transacción). Requiere PostgreSQL 15 o superior
-- (UNIQUE ... NULLS NOT DISTINCT; Supabase usa 15 o 17).
--
-- 1. clientes.diferencia_puestos (falso por defecto) y catálogo public.puestos (cliente, nombre, activo).
-- 2. prenda_clientes.puesto_id: nulo para clientes sin puestos, obligatorio para los que sí. La unicidad pasa a
--    (prenda, cliente, puesto, renovación) y la regla AMBOS frente a VERANO/INVIERNO se aplica dentro de cada puesto.
-- 3. requerimientos.puesto_id (inmutable) validado en crear_requerimiento, editar_prendas_requerimiento y por trigger.
-- 4. Listados, filtros y detalle devuelven el puesto; la importación de prendas acepta la columna puesto.
-- 5. admin_exportar_prendas: todas las asignaciones (con su estado) y las prendas sin asignación, en el formato de la importación.
-- Los clientes actuales quedan con diferencia_puestos=false y todo sigue igual para ellos.
begin;

-- ===== 1. esquema =====
alter table public.clientes add column diferencia_puestos boolean not null default false;

create table public.puestos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  nombre text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint puestos_nombre_valido check (nombre=btrim(nombre) and char_length(nombre) between 1 and 200 and nombre !~ '[\\u0000-\\u001f]'),
  constraint puestos_id_cliente_uk unique (id,cliente_id)
);
create unique index puestos_cliente_nombre_uidx on public.puestos(cliente_id,lower(nombre));

alter table public.prenda_clientes add column puesto_id uuid;
alter table public.prenda_clientes add constraint prenda_clientes_puesto_fkey
  foreign key (puesto_id,cliente_id) references public.puestos(id,cliente_id) on delete restrict;
alter table public.prenda_clientes drop constraint prenda_clientes_unica;
alter table public.prenda_clientes add constraint prenda_clientes_unica unique nulls not distinct (prenda_id,cliente_id,puesto_id,renovacion);
create index prenda_clientes_puesto_idx on public.prenda_clientes(cliente_id,puesto_id,renovacion) where activo;

alter table public.requerimientos add column puesto_id uuid;
alter table public.requerimientos add constraint requerimientos_puesto_id_fkey
  foreign key (puesto_id,cliente_id) references public.puestos(id,cliente_id) on delete restrict;
create index requerimientos_puesto_idx on public.requerimientos(puesto_id) where puesto_id is not null;

alter table public.puestos enable row level security;
create policy puestos_lectura on public.puestos for select to authenticated using (activo or (select public.is_admin()));
create policy puestos_historial on public.puestos for select to authenticated
  using (exists(select 1 from public.requerimientos r where r.puesto_id=puestos.id));
revoke all on public.puestos from public,anon,authenticated;
grant select on public.puestos to authenticated;
grant select,insert,update,delete on public.puestos to service_role;

alter table private.admin_catalog_audit drop constraint admin_catalog_audit_catalogo_check;
alter table private.admin_catalog_audit add constraint admin_catalog_audit_catalogo_check
  check (catalogo in ('clientes','unidades','personal','prendas','provincias','puestos'));

-- ===== 2. triggers =====
create function private.puestos_validar() returns trigger language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
  if tg_op='UPDATE' and new.cliente_id<>old.cliente_id then
    raise exception 'Un puesto no puede cambiar de cliente' using errcode='55000';
  end if;
  if tg_op='INSERT' and not exists(select 1 from public.clientes c where c.id=new.cliente_id and c.diferencia_puestos) then
    raise exception 'El cliente no diferencia prendas por puesto' using errcode='22023';
  end if;
  new.updated_at:=now();
  return new;
end $$;
revoke all on function private.puestos_validar() from public,anon,authenticated;
create trigger puestos_validar before insert or update on public.puestos for each row execute function private.puestos_validar();

create function private.clientes_puestos_validar() returns trigger language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
  if new.diferencia_puestos is distinct from old.diferencia_puestos then
    if new.diferencia_puestos and exists(select 1 from public.prenda_clientes a where a.cliente_id=new.id and a.activo) then
      raise exception 'El cliente tiene asignaciones de prendas vigentes sin puesto: desactívalas antes de activar "Diferencia prendas por puesto"' using errcode='55000';
    end if;
    if not new.diferencia_puestos and exists(select 1 from public.prenda_clientes a where a.cliente_id=new.id and a.activo and a.puesto_id is not null) then
      raise exception 'El cliente tiene asignaciones de prendas vigentes por puesto: desactívalas antes de quitar "Diferencia prendas por puesto"' using errcode='55000';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.clientes_puestos_validar() from public,anon,authenticated;
create trigger clientes_puestos_validar before update of diferencia_puestos on public.clientes
  for each row execute function private.clientes_puestos_validar();

create or replace function private.prenda_clientes_validar() returns trigger language plpgsql
set search_path=pg_catalog,public,pg_temp as $$
declare v_usa boolean;
begin
  if tg_op='UPDATE' and (new.prenda_id<>old.prenda_id or new.cliente_id<>old.cliente_id) then
    raise exception 'Una asignación no puede cambiar de prenda ni de cliente' using errcode='55000';
  end if;
  if tg_op='UPDATE' and new.puesto_id is distinct from old.puesto_id then
    raise exception 'Una asignación no puede cambiar de puesto' using errcode='55000';
  end if;
  new.updated_at:=now();
  select c.diferencia_puestos into v_usa from public.clientes c where c.id=new.cliente_id;
  -- Clientes con puestos: el puesto es obligatorio; clientes sin puestos: debe ser nulo. En filas inactivas ya existentes solo se exige al crearlas.
  if tg_op='INSERT' or new.activo then
    if v_usa and new.puesto_id is null then
      raise exception 'El cliente diferencia prendas por puesto: elige el puesto de la asignación' using errcode='22023';
    end if;
    if not v_usa and new.puesto_id is not null then
      raise exception 'El cliente no diferencia prendas por puesto' using errcode='22023';
    end if;
  end if;
  if new.activo and new.puesto_id is not null and (tg_op='INSERT' or not old.activo)
    and not exists(select 1 from public.puestos pu where pu.id=new.puesto_id and pu.cliente_id=new.cliente_id and pu.activo) then
    raise exception 'El puesto está inactivo' using errcode='55000';
  end if;
  if new.activo then
    -- Serializa altas concurrentes de la misma prenda, cliente y puesto.
    perform pg_advisory_xact_lock(pg_catalog.hashtextextended('prenda_cliente:'||new.prenda_id::text||':'||new.cliente_id::text||':'||coalesce(new.puesto_id::text,''),0));
    if exists(select 1 from public.prenda_clientes o
      where o.prenda_id=new.prenda_id and o.cliente_id=new.cliente_id and o.puesto_id is not distinct from new.puesto_id
        and o.id is distinct from new.id
        and o.activo and o.renovacion<>new.renovacion and (o.renovacion='AMBOS' or new.renovacion='AMBOS')) then
      raise exception 'AMBOS no puede convivir con VERANO o INVIERNO para la misma prenda, cliente y puesto' using errcode='23P01';
    end if;
  end if;
  return new;
end $$;

""")

t = defn("public.proteger_requerimiento_actualizado()")
t = sub(t, "    or new.unidad_id is distinct from old.unidad_id\n", "    or new.unidad_id is distinct from old.unidad_id\n    or new.puesto_id is distinct from old.puesto_id\n")
add(semi(t))

add("""
create or replace function public.validar_destino_requerimiento() returns trigger language plpgsql
set search_path=pg_catalog,public,pg_temp as $$
declare v_usa boolean;
begin
  if new.cliente_id is null or new.unidad_id is null then
    raise exception 'Selecciona un cliente y una unidad';
  end if;
  select c.diferencia_puestos into v_usa from public.clientes c join public.unidades u
      on u.cliente_id=c.id where c.id=new.cliente_id and u.id=new.unidad_id and c.activo and u.activo;
  if not found then
    raise exception 'Cliente o unidad inválidos o inactivos';
  end if;
  if v_usa and new.puesto_id is null then
    raise exception 'Selecciona el puesto' using errcode='22023';
  end if;
  if not v_usa and new.puesto_id is not null then
    raise exception 'El cliente no diferencia prendas por puesto' using errcode='22023';
  end if;
  if new.puesto_id is not null and not exists(select 1 from public.puestos pu where pu.id=new.puesto_id and pu.cliente_id=new.cliente_id and pu.activo) then
    raise exception 'Puesto inválido o inactivo' using errcode='22023';
  end if;
  return new;
end;
$$;

""")

# ===== prenda_json =====
t = defn("private.prenda_json(uuid)")
t = sub(t, "'cliente',c.nombre,'renovacion',a.renovacion,", "'cliente',c.nombre,'puesto_id',a.puesto_id,'puesto',pu.nombre,'renovacion',a.renovacion,")
t = sub(t, "order by c.nombre,a.renovacion)\n    from public.prenda_clientes a join public.clientes c on c.id=a.cliente_id where a.prenda_id=p.id)",
        "order by c.nombre,pu.nombre nulls first,a.renovacion)\n    from public.prenda_clientes a join public.clientes c on c.id=a.cliente_id\n    left join public.puestos pu on pu.id=a.puesto_id where a.prenda_id=p.id)")
add(semi(t))

# ===== listar_prendas_cliente (nueva firma con puesto) =====
add("drop function public.listar_prendas_cliente(uuid,text);\n")
add("""create function public.listar_prendas_cliente(p_cliente_id uuid, p_renovacion text, p_puesto_id uuid default null)
 returns table(id uuid, codigo_prenda text, nombre_prenda text, codigo_almacen text, precio numeric, genero text, cantidad integer, renovacion text, activo boolean)
 language plpgsql stable set search_path=pg_catalog,public,pg_temp as $$
declare v_usa boolean;
begin
  if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_cliente_id is null or p_renovacion is null or p_renovacion not in ('VERANO','INVIERNO') then
    raise exception 'Cliente o renovación inválidos' using errcode='22023';
  end if;
  select c.diferencia_puestos into v_usa from public.clientes c where c.id=p_cliente_id;
  if v_usa is null then raise exception 'Cliente o renovación inválidos' using errcode='22023'; end if;
  if v_usa and (p_puesto_id is null or not exists(select 1 from public.puestos pu where pu.id=p_puesto_id and pu.cliente_id=p_cliente_id)) then
    raise exception 'Selecciona un puesto del cliente' using errcode='22023';
  end if;
  if not v_usa and p_puesto_id is not null then
    raise exception 'El cliente no diferencia prendas por puesto' using errcode='22023';
  end if;
  return query
    select p.id,p.codigo_prenda,p.nombre_prenda,p.codigo_almacen,p.precio,a.genero,a.cantidad,a.renovacion,p.activo
    from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id
    where a.cliente_id=p_cliente_id and a.puesto_id is not distinct from p_puesto_id and a.activo and p.activo
      and a.renovacion in (p_renovacion,'AMBOS')
    order by p.nombre_prenda,p.id;
end $$;
revoke all on function public.listar_prendas_cliente(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.listar_prendas_cliente(uuid,text,uuid) to authenticated;

""")

# ===== crear_requerimiento =====
add("drop function public.crear_requerimiento(uuid,uuid,uuid,text,jsonb,uuid,text);\n")
t = defn("public.crear_requerimiento(uuid,uuid,uuid,text,jsonb,uuid,text)")
t = sub(t, "p_request_id uuid, p_genero text)", "p_request_id uuid, p_genero text, p_puesto_id uuid DEFAULT NULL::uuid)")
t = sub(t, "  v_cliente text;\n", "  v_cliente text;\n  v_usa boolean;\n")
t = sub(t, "  select nombre into v_cliente from public.clientes where id=p_cliente_id and activo for share;\n  if not found then raise exception 'Selecciona un cliente activo'; end if;\n",
        """  select nombre,diferencia_puestos into v_cliente,v_usa from public.clientes where id=p_cliente_id and activo for share;
  if not found then raise exception 'Selecciona un cliente activo'; end if;
  if v_usa and p_puesto_id is null then raise exception 'Selecciona el puesto' using errcode='22023'; end if;
  if not v_usa and p_puesto_id is not null then raise exception 'El cliente no diferencia prendas por puesto' using errcode='22023'; end if;
  if p_puesto_id is not null then
    perform 1 from public.puestos pu where pu.id=p_puesto_id and pu.cliente_id=p_cliente_id and pu.activo for share;
    if not found then raise exception 'Selecciona un puesto activo del cliente' using errcode='22023'; end if;
  end if;
""")
t = sub(t, "and a.renovacion in (p_renovacion,'AMBOS') and a.genero in (p_genero,'AMBOS')",
        "and a.puesto_id is not distinct from p_puesto_id\n      and a.renovacion in (p_renovacion,'AMBOS') and a.genero in (p_genero,'AMBOS')", 2)
t = sub(t, "insert into public.requerimientos(agente_id,usuario_creador_id,cliente_id,unidad_id,renovacion,referencia_interna,request_id)\n    values(p_agente_id,auth.uid(),p_cliente_id,p_unidad_id,p_renovacion,'RENOVACION '||p_renovacion,p_request_id)",
        "insert into public.requerimientos(agente_id,usuario_creador_id,cliente_id,unidad_id,puesto_id,renovacion,referencia_interna,request_id)\n    values(p_agente_id,auth.uid(),p_cliente_id,p_unidad_id,p_puesto_id,p_renovacion,'RENOVACION '||p_renovacion,p_request_id)")
t = sub(t, "La prenda no corresponde al cliente, la renovación ni el género seleccionados, o está inactiva", "La prenda no corresponde al cliente, el puesto, la renovación ni el género seleccionados, o está inactiva")
add(semi(t))
add("revoke all on function public.crear_requerimiento(uuid,uuid,uuid,text,jsonb,uuid,text,uuid) from public,anon,authenticated;\ngrant execute on function public.crear_requerimiento(uuid,uuid,uuid,text,jsonb,uuid,text,uuid) to authenticated;\n\n")

# ===== obtener_edicion_prendas / editar_prendas_requerimiento =====
t = defn("public.obtener_edicion_prendas(uuid)")
t = sub(t, "      and a.renovacion in (v_row.renovacion,'AMBOS')\n    where d.requerimiento_id=p_id and d.activo;",
        "      and a.puesto_id is not distinct from v_row.puesto_id and a.renovacion in (v_row.renovacion,'AMBOS')\n    where d.requerimiento_id=p_id and d.activo;")
t = sub(t, "      'unidades',case when u.id is not null then jsonb_build_object('nombre',u.nombre) end,\n",
        "      'unidades',case when u.id is not null then jsonb_build_object('nombre',u.nombre) end,\n      'puestos',case when pu.id is not null then jsonb_build_object('nombre',pu.nombre) end,\n")
t = sub(t, "    left join public.unidades u on u.id=r.unidad_id where r.id=p_id;", "    left join public.unidades u on u.id=r.unidad_id left join public.puestos pu on pu.id=r.puesto_id where r.id=p_id;")
add(semi(t))

t = defn("public.editar_prendas_requerimiento(uuid,text,jsonb,text)")
t = sub(t, "where g.id=x.prenda_id and g.activo and a.activo and a.cliente_id=v_row.cliente_id\n        and a.renovacion in (v_row.renovacion,'AMBOS')",
        "where g.id=x.prenda_id and g.activo and a.activo and a.cliente_id=v_row.cliente_id\n        and a.puesto_id is not distinct from v_row.puesto_id and a.renovacion in (v_row.renovacion,'AMBOS')")
t = sub(t, "    where d.requerimiento_id=p_id and d.activo and a.prenda_id=d.prenda_id and a.cliente_id=v_row.cliente_id\n      and a.activo and a.renovacion in (v_row.renovacion,'AMBOS');",
        "    where d.requerimiento_id=p_id and d.activo and a.prenda_id=d.prenda_id and a.cliente_id=v_row.cliente_id\n      and a.puesto_id is not distinct from v_row.puesto_id and a.activo and a.renovacion in (v_row.renovacion,'AMBOS');")
t = sub(t, "join public.prenda_clientes a on a.prenda_id=g.id and a.cliente_id=v_row.cliente_id and a.activo\n      and a.renovacion in (v_row.renovacion,'AMBOS')\n    where x.detalle_id is null;",
        "join public.prenda_clientes a on a.prenda_id=g.id and a.cliente_id=v_row.cliente_id and a.activo\n      and a.puesto_id is not distinct from v_row.puesto_id and a.renovacion in (v_row.renovacion,'AMBOS')\n    where x.detalle_id is null;")
t = sub(t, "La prenda no corresponde al cliente, la renovación ni el género, o está inactiva", "La prenda no corresponde al cliente, el puesto, la renovación ni el género, o está inactiva")
add(semi(t))

# ===== listados de requerimientos =====
GEN_OLD = "where a.prenda_id=dr.prenda_id and a.cliente_id=r.cliente_id and a.renovacion in (r.renovacion,'AMBOS') order by"
GEN_NEW = "where a.prenda_id=dr.prenda_id and a.cliente_id=r.cliente_id and a.puesto_id is not distinct from r.puesto_id and a.renovacion in (r.renovacion,'AMBOS') order by"

sig_f = "public.listar_requerimientos_filtrados(uuid,uuid,estado_requerimiento,text,integer,integer,integer,integer,text,integer,integer,text)"
add("drop function public.listar_requerimientos_filtrados(uuid,uuid,estado_requerimiento,text,integer,integer,integer,integer,text,integer,integer,text);\n")
t = defn(sig_f)
t = sub(t, "p_renovacion text DEFAULT NULL::text)", "p_renovacion text DEFAULT NULL::text, p_puesto_id uuid DEFAULT NULL::uuid)")
t = sub(t, "r.estado,r.renovacion,r.usuario_creador_id,r.cliente_id,r.unidad_id,\n", "r.estado,r.renovacion,r.usuario_creador_id,r.cliente_id,r.unidad_id,r.puesto_id,\n")
t = sub(t, "      case when u.id is not null then jsonb_build_object('nombre',u.nombre) end unidades,\n", "      case when u.id is not null then jsonb_build_object('nombre',u.nombre) end unidades,\n      case when pu.id is not null then jsonb_build_object('nombre',pu.nombre) end puestos,\n")
t = sub(t, "    left join public.unidades u on u.id=r.unidad_id\n    left join lateral (", "    left join public.unidades u on u.id=r.unidad_id left join public.puestos pu on pu.id=r.puesto_id\n    left join lateral (")
t = sub(t, GEN_OLD, GEN_NEW)
t = sub(t, "      and (p_renovacion is null or x.renovacion=p_renovacion)\n", "      and (p_renovacion is null or x.renovacion=p_renovacion) and (p_puesto_id is null or x.puesto_id=p_puesto_id)\n")
t = sub(t, "x.unidades->>'nombre',x.referencia_interna", "x.unidades->>'nombre',x.puestos->>'nombre',x.referencia_interna")
add(semi(t))
add("revoke all on function public.listar_requerimientos_filtrados(uuid,uuid,estado_requerimiento,text,integer,integer,integer,integer,text,integer,integer,text,uuid) from public,anon,authenticated;\ngrant execute on function public.listar_requerimientos_filtrados(uuid,uuid,estado_requerimiento,text,integer,integer,integer,integer,text,integer,integer,text,uuid) to authenticated;\n\n")

sig_v2 = "public.admin_consultar_requerimientos_v2(uuid,uuid,uuid,estado_requerimiento,timestamp with time zone,timestamp with time zone,text,text,integer,integer,boolean,text,text,integer,integer,boolean,timestamp with time zone,uuid,timestamp with time zone,text)"
add("drop function public.admin_consultar_requerimientos_v2(uuid,uuid,uuid,estado_requerimiento,timestamp with time zone,timestamp with time zone,text,text,integer,integer,boolean,text,text,integer,integer,boolean,timestamp with time zone,uuid,timestamp with time zone,text);\n")
t = defn(sig_v2)
t = sub(t, "p_renovacion text DEFAULT NULL::text)", "p_renovacion text DEFAULT NULL::text, p_puesto_id uuid DEFAULT NULL::uuid)")
t = sub(t, "r.renovacion,r.agente_id,r.cliente_id,r.unidad_id,r.usuario_creador_id,\n", "r.renovacion,r.agente_id,r.cliente_id,r.unidad_id,r.puesto_id,r.usuario_creador_id,\n")
t = sub(t, "      case when u.id is not null then jsonb_build_object('nombre',u.nombre) end unidades,\n", "      case when u.id is not null then jsonb_build_object('nombre',u.nombre) end unidades,\n      case when pu.id is not null then jsonb_build_object('nombre',pu.nombre) end puestos,\n")
t = sub(t, "left join public.clientes c on c.id=r.cliente_id left join public.unidades u on u.id=r.unidad_id\n", "left join public.clientes c on c.id=r.cliente_id left join public.unidades u on u.id=r.unidad_id\n    left join public.puestos pu on pu.id=r.puesto_id\n")
t = sub(t, GEN_OLD, GEN_NEW)
t = sub(t, "and (p_renovacion is null or a.renovacion=p_renovacion) and (p_desde", "and (p_renovacion is null or a.renovacion=p_renovacion) and (p_puesto_id is null or a.puesto_id=p_puesto_id) and (p_desde")
t = sub(t, "a.clientes->>'nombre',a.unidades->>'nombre',a.profiles->>'nombre'", "a.clientes->>'nombre',a.unidades->>'nombre',a.puestos->>'nombre',a.profiles->>'nombre'")
add(semi(t))
add("revoke all on function public.admin_consultar_requerimientos_v2(uuid,uuid,uuid,estado_requerimiento,timestamp with time zone,timestamp with time zone,text,text,integer,integer,boolean,text,text,integer,integer,boolean,timestamp with time zone,uuid,timestamp with time zone,text,uuid) from public,anon,authenticated;\ngrant execute on function public.admin_consultar_requerimientos_v2(uuid,uuid,uuid,estado_requerimiento,timestamp with time zone,timestamp with time zone,text,text,integer,integer,boolean,text,text,integer,integer,boolean,timestamp with time zone,uuid,timestamp with time zone,text,uuid) to authenticated;\n\n")

# ===== opciones para filtros =====
t = defn("public.admin_opciones_requerimientos()")
t = sub(t, "    'unidades', (select coalesce(jsonb_agg(to_jsonb(u) order by u.nombre,u.id),'[]') from (select id,cliente_id,nombre from unidades) u),\n",
        "    'unidades', (select coalesce(jsonb_agg(to_jsonb(u) order by u.nombre,u.id),'[]') from (select id,cliente_id,nombre from unidades) u),\n    'puestos', (select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre,x.id),'[]') from (select id,cliente_id,nombre from puestos) x),\n")
add(semi(t))
t = defn("public.opciones_requerimientos_propios()")
t = sub(t, "      select distinct u.id,u.cliente_id,u.nombre from public.requerimientos r join public.unidades u on u.id=r.unidad_id\n      where r.usuario_creador_id=auth.uid()) x),'[]'::jsonb)\n",
        "      select distinct u.id,u.cliente_id,u.nombre from public.requerimientos r join public.unidades u on u.id=r.unidad_id\n      where r.usuario_creador_id=auth.uid()) x),'[]'::jsonb),\n    'puestos',coalesce((select jsonb_agg(to_jsonb(x) order by x.nombre,x.id) from (\n      select distinct pu.id,pu.cliente_id,pu.nombre from public.requerimientos r join public.puestos pu on pu.id=r.puesto_id\n      where r.usuario_creador_id=auth.uid()) x),'[]'::jsonb)\n")
add(semi(t))

# ===== catálogos =====
t = defn("public.admin_listar_catalogo(text,text,uuid,text,integer,integer)")
t = sub(t, "p_catalogo not in ('clientes','unidades','personal','prendas','provincias')", "p_catalogo not in ('clientes','unidades','personal','prendas','provincias','puestos')")
t = sub(t, "select c.id,c.nombre,c.activo from public.clientes c", "select c.id,c.nombre,c.activo,c.diferencia_puestos from public.clientes c")
t = sub(t, "    when 'unidades' then\n      select count(*) into v_total from public.unidades u where",
        """    when 'puestos' then
      select count(*) into v_total from public.puestos pu where (p_cliente_id is null or pu.cliente_id=p_cliente_id)
        and (v_q='' or position(v_q in lower(pu.nombre))>0);
      select coalesce(jsonb_agg((to_jsonb(x)-'cliente_orden') order by x.cliente_orden,x.nombre,x.id),'[]') into v_rows from (
        select pu.id,pu.cliente_id,pu.nombre,pu.activo,jsonb_build_object('nombre',c.nombre) clientes,lower(c.nombre) cliente_orden
        from public.puestos pu join public.clientes c on c.id=pu.cliente_id
        where (p_cliente_id is null or pu.cliente_id=p_cliente_id) and (v_q='' or position(v_q in lower(pu.nombre))>0)
        order by lower(c.nombre),pu.nombre,pu.id limit p_limite offset p_offset) x;
    when 'unidades' then
      select count(*) into v_total from public.unidades u where""")
t = sub(t, "'cliente',c.nombre,\n            'renovacion',a.renovacion,'genero',a.genero,'cantidad',a.cantidad,'activo',a.activo) order by c.nombre,a.renovacion)\n            from public.prenda_clientes a join public.clientes c on c.id=a.cliente_id where a.prenda_id=p.id),'[]'::jsonb) asignaciones",
        "'cliente',c.nombre,\n            'puesto_id',a.puesto_id,'puesto',pu.nombre,'renovacion',a.renovacion,'genero',a.genero,'cantidad',a.cantidad,'activo',a.activo) order by c.nombre,pu.nombre nulls first,a.renovacion)\n            from public.prenda_clientes a join public.clientes c on c.id=a.cliente_id\n            left join public.puestos pu on pu.id=a.puesto_id where a.prenda_id=p.id),'[]'::jsonb) asignaciones")
add(semi(t))
# quita la columna auxiliar cliente_orden del resultado de puestos
add("")

t = defn("private.admin_guardar_catalogo(text,uuid,jsonb)")
t = sub(t, "  v_cliente_id uuid; v_cliente_nombre text;", "  v_usa boolean; v_puesto_id uuid; v_cliente_id uuid; v_cliente_nombre text;")
t = sub(t, "p_catalogo not in ('clientes','unidades','personal','prendas','provincias') or p_valores is null", "p_catalogo not in ('clientes','unidades','personal','prendas','provincias','puestos') or p_valores is null")
# clientes
t = sub(t, "      if (p_valores-'nombre')<>'{}'::jsonb then raise exception 'Campos de cliente inválidos' using errcode='22023'; end if;\n",
        "      if (p_valores-'nombre'-'diferencia_puestos')<>'{}'::jsonb\n        or (p_valores ? 'diferencia_puestos' and jsonb_typeof(p_valores->'diferencia_puestos')<>'boolean') then\n        raise exception 'Campos de cliente inválidos' using errcode='22023'; end if;\n      v_usa:=case when p_valores ? 'diferencia_puestos' then (p_valores->>'diferencia_puestos')::boolean end;\n")
t = sub(t, "insert into public.clientes(nombre,activo) values(v_nombre,true) returning", "insert into public.clientes(nombre,activo,diferencia_puestos) values(v_nombre,true,coalesce(v_usa,false)) returning")
t = sub(t, "update public.clientes set nombre=v_nombre where id=p_id returning", "update public.clientes set nombre=v_nombre,diferencia_puestos=coalesce(v_usa,diferencia_puestos) where id=p_id returning")
# puestos (antes de 'unidades')
t = sub(t, "    when 'unidades' then\n      if (p_valores-'nombre'-'cliente_id'",
        """    when 'puestos' then
      if (p_valores-'nombre'-'cliente_id')<>'{}'::jsonb then raise exception 'Campos de puesto inválidos' using errcode='22023'; end if;
      v_nombre:=btrim(p_valores->>'nombre');
      begin v_cliente_id:=(p_valores->>'cliente_id')::uuid;
      exception when invalid_text_representation then raise exception 'Selecciona un cliente válido' using errcode='22023'; end;
      if nullif(v_nombre,'') is null or length(v_nombre)>200 or v_nombre~'[\\u0000-\\u001f]' then
        raise exception 'El nombre del puesto es obligatorio y admite hasta 200 caracteres' using errcode='22023';
      end if;
      select c.nombre,c.activo,c.diferencia_puestos into v_cliente_nombre,v_cliente_activo,v_usa from public.clientes c where c.id=v_cliente_id for share;
      if not found then raise exception 'Cliente no encontrado' using errcode='P0002'; end if;
      if not v_usa then raise exception 'Este cliente no diferencia prendas por puesto: actívalo en Clientes primero' using errcode='22023'; end if;
      perform pg_advisory_xact_lock(hashtextextended('puesto:'||v_cliente_id::text||':'||lower(v_nombre),0));
      if exists(select 1 from public.puestos pu where pu.cliente_id=v_cliente_id and lower(pu.nombre)=lower(v_nombre) and pu.id is distinct from p_id) then
        raise exception 'Ya existe un puesto con ese nombre para el cliente' using errcode='23505';
      end if;
      if p_id is null then
        if not v_cliente_activo then raise exception 'Reactiva el cliente antes de crear puestos' using errcode='55000'; end if;
        insert into public.puestos(cliente_id,nombre,activo) values(v_cliente_id,v_nombre,true) returning to_jsonb(puestos.*) into v_despues;
      else
        select to_jsonb(pu.*) into v_antes from public.puestos pu where pu.id=p_id for update;
        if v_antes is null then raise exception 'Puesto no encontrado' using errcode='P0002'; end if;
        if (v_antes->>'cliente_id')::uuid<>v_cliente_id then raise exception 'Un puesto no puede cambiar de cliente' using errcode='55000'; end if;
        update public.puestos set nombre=v_nombre where id=p_id returning to_jsonb(puestos.*) into v_despues;
      end if;

    when 'unidades' then
      if (p_valores-'nombre'-'cliente_id'""")
# prendas: asignaciones con puesto
t = sub(t, "(v_a-'id'-'cliente_id'-'renovacion'-'genero'-'cantidad'-'activo')<>'{}'::jsonb", "(v_a-'id'-'cliente_id'-'puesto_id'-'renovacion'-'genero'-'cantidad'-'activo')<>'{}'::jsonb")
t = sub(t, "          or jsonb_typeof(v_a->'activo')<>'boolean' then\n          raise exception 'Revisa las asignaciones: cliente, renovación, género, cantidad y estado' using errcode='22023';\n        end if;\n",
        "          or jsonb_typeof(v_a->'activo')<>'boolean'\n          or (v_a ? 'puesto_id' and jsonb_typeof(v_a->'puesto_id') not in ('null','string')) then\n          raise exception 'Revisa las asignaciones: cliente, puesto, renovación, género, cantidad y estado' using errcode='22023';\n        end if;\n        begin v_puesto_id:=nullif(v_a->>'puesto_id','')::uuid;\n        exception when invalid_text_representation then raise exception 'Selecciona un puesto válido' using errcode='22023'; end;\n")
t = sub(t, "                and (v_a->>'cliente_id' is null or cliente_id=(v_a->>'cliente_id')::uuid);",
        "                and (v_a->>'cliente_id' is null or cliente_id=(v_a->>'cliente_id')::uuid)\n                and puesto_id is not distinct from v_puesto_id;")
t = sub(t, "            insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,genero,cantidad,activo)\n              values(v_prenda_id,v_cliente_id,v_a->>'renovacion',v_a->>'genero',(v_a->>'cantidad')::integer,(v_a->>'activo')::boolean);",
        "            insert into public.prenda_clientes(prenda_id,cliente_id,puesto_id,renovacion,genero,cantidad,activo)\n              values(v_prenda_id,v_cliente_id,v_puesto_id,v_a->>'renovacion',v_a->>'genero',(v_a->>'cantidad')::integer,(v_a->>'activo')::boolean);")
t = sub(t, "Esa prenda ya tiene una asignación para el mismo cliente y renovación", "Esa prenda ya tiene una asignación para el mismo cliente, puesto y renovación")
add(semi(t))

t = defn("private.admin_actualizar_catalogo_activo(text,uuid,boolean)")
t = sub(t, "p_catalogo not in ('clientes','unidades','personal','prendas','provincias')", "p_catalogo not in ('clientes','unidades','personal','prendas','provincias','puestos')")
t = sub(t, "    when 'provincias' then select to_jsonb(p.*) into v_antes from public.provincias p where p.id=p_id for update;\n",
        "    when 'provincias' then select to_jsonb(p.*) into v_antes from public.provincias p where p.id=p_id for update;\n    when 'puestos' then select to_jsonb(pu.*) into v_antes from public.puestos pu where pu.id=p_id for update;\n")
t = sub(t, "    when 'provincias' then update public.provincias set activo=p_activo where id=p_id returning to_jsonb(provincias.*) into v_despues;\n",
        "    when 'provincias' then update public.provincias set activo=p_activo where id=p_id returning to_jsonb(provincias.*) into v_despues;\n    when 'puestos' then update public.puestos set activo=p_activo where id=p_id returning to_jsonb(puestos.*) into v_despues;\n")
add(semi(t))

t = defn("private.admin_eliminar_catalogo(text,uuid)")
t = sub(t, "if exists(select 1 from public.unidades u where u.cliente_id=p_id)\n", "if exists(select 1 from public.unidades u where u.cliente_id=p_id)\n        or exists(select 1 from public.puestos pu where pu.cliente_id=p_id)\n")
add(semi(t))
t = defn("public.admin_capacidades_catalogo(text,uuid[])")
t = sub(t, "        not exists(select 1 from public.unidades u where u.cliente_id=c.id)\n", "        not exists(select 1 from public.unidades u where u.cliente_id=c.id)\n        and not exists(select 1 from public.puestos pu where pu.cliente_id=c.id)\n")
add(semi(t))

# ===== importación de prendas =====
add("drop function private.prendas_import_filas(jsonb);\n")
t = defn("private.prendas_import_filas(jsonb)")
t = sub(t, "genero text, renovacion text, activo boolean)", "genero text, renovacion text, activo boolean, puesto text)")
t = sub(t, "-'renovacion'-'activo')<>'{}'::jsonb", "-'renovacion'-'activo'-'puesto')<>'{}'::jsonb")
t = sub(t, "      or jsonb_typeof(v->'activo')<>'boolean' then", "      or jsonb_typeof(v->'activo')<>'boolean'\n      or (v ? 'puesto' and (jsonb_typeof(v->'puesto') not in ('null','string') or length(btrim(coalesce(v->>'puesto','')))>200)) then")
t = sub(t, "activo:=(v->'activo')::boolean;", "activo:=(v->'activo')::boolean;\n    puesto:=nullif(btrim(coalesce(v->>'puesto','')),'');")
add(semi(t))
add("revoke all on function private.prendas_import_filas(jsonb) from public,anon,authenticated;\ngrant execute on function private.prendas_import_filas(jsonb) to authenticated;\n\n")

t = defn("private.admin_importar_prendas(uuid,jsonb,boolean,jsonb,boolean)")
t = sub(t, "  v_cliente text; v_f jsonb;", "  v_cliente text; v_usa boolean; v_f jsonb;")
t = sub(t, "select c.nombre into v_cliente from public.clientes c where c.id=p_cliente_id and c.activo for share;", "select c.nombre,c.diferencia_puestos into v_cliente,v_usa from public.clientes c where c.id=p_cliente_id and c.activo for share;")
t = sub(t, """  create temp table imp_f on commit drop as
    select * from jsonb_to_recordset(v_f) as f(fila integer,codigo_prenda text,nombre_prenda text,codigo_almacen text,
      precio numeric,cantidad integer,genero text,renovacion text,activo boolean);
""", """  create temp table imp_f on commit drop as
    select f.*,pu.id as puesto_id,pu.activo as puesto_activo
    from jsonb_to_recordset(v_f) as f(fila integer,codigo_prenda text,nombre_prenda text,codigo_almacen text,
      precio numeric,cantidad integer,genero text,renovacion text,activo boolean,puesto text)
    left join public.puestos pu on pu.cliente_id=p_cliente_id and lower(pu.nombre)=lower(btrim(f.puesto));
  -- Defensa (la pantalla ya marca estos errores por fila): puesto obligatorio y existente si el cliente usa puestos; prohibido si no.
  if v_usa and exists(select 1 from pg_temp.imp_f where puesto_id is null) then
    raise exception 'El cliente % diferencia prendas por puesto: la fila % no trae un puesto válido',v_cliente,
      (select min(fila) from pg_temp.imp_f where puesto_id is null) using errcode='22023'; end if;
  if not v_usa and exists(select 1 from pg_temp.imp_f where puesto is not null) then
    raise exception 'El cliente % no diferencia prendas por puesto: quita la columna puesto (fila %)',v_cliente,
      (select min(fila) from pg_temp.imp_f where puesto is not null) using errcode='22023'; end if;
  if exists(select 1 from pg_temp.imp_f where activo and puesto_id is not null and not puesto_activo) then
    raise exception 'La fila % usa un puesto inactivo',(select min(fila) from pg_temp.imp_f where activo and puesto_id is not null and not puesto_activo) using errcode='22023'; end if;
""")
t = sub(t, "group by codigo_prenda,renovacion having count(*)>1", "group by codigo_prenda,renovacion,puesto_id having count(*)>1")
t = sub(t, "    and a.renovacion='AMBOS' and b.renovacion<>'AMBOS') then", "    and a.puesto_id is not distinct from b.puesto_id and a.renovacion='AMBOS' and b.renovacion<>'AMBOS') then")
t = sub(t, "    select a.id as asignacion_id,p.codigo_prenda,p.nombre_prenda,a.renovacion as de,\n      (select string_agg(distinct f.renovacion,' y ' order by f.renovacion) from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda) as a_renovacion",
        "    select a.id as asignacion_id,a.puesto_id,p.codigo_prenda,p.nombre_prenda,a.renovacion as de,\n      (select string_agg(distinct f.renovacion,' y ' order by f.renovacion) from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.puesto_id is not distinct from a.puesto_id) as a_renovacion")
t = sub(t, """      and exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.renovacion<>a.renovacion
        and (a.renovacion='AMBOS' or f.renovacion='AMBOS'))
      and not exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.renovacion=a.renovacion);""",
        """      and exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.puesto_id is not distinct from a.puesto_id and f.renovacion<>a.renovacion
        and (a.renovacion='AMBOS' or f.renovacion='AMBOS'))
      and not exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.puesto_id is not distinct from a.puesto_id and f.renovacion=a.renovacion);""")
t = sub(t, "    from pg_temp.imp_repl r join pg_temp.imp_f f on f.codigo_prenda=r.codigo_prenda\n    where (select count(*) from pg_temp.imp_f x where x.codigo_prenda=r.codigo_prenda)=1\n      and (select count(*) from pg_temp.imp_repl y where y.codigo_prenda=r.codigo_prenda)=1\n",
        "    from pg_temp.imp_repl r join pg_temp.imp_f f on f.codigo_prenda=r.codigo_prenda and f.puesto_id is not distinct from r.puesto_id\n    where (select count(*) from pg_temp.imp_f x where x.codigo_prenda=r.codigo_prenda and x.puesto_id is not distinct from r.puesto_id)=1\n      and (select count(*) from pg_temp.imp_repl y where y.codigo_prenda=r.codigo_prenda and y.puesto_id is not distinct from r.puesto_id)=1\n")
t = sub(t, "where e.cliente_id=p_cliente_id and pe.codigo_prenda=r.codigo_prenda and e.renovacion=f.renovacion);", "where e.cliente_id=p_cliente_id and e.puesto_id is not distinct from r.puesto_id and pe.codigo_prenda=r.codigo_prenda and e.renovacion=f.renovacion);")
t = sub(t, "left join public.prenda_clientes a on a.prenda_id=p.id and a.cliente_id=p_cliente_id and a.renovacion=o.renovacion\n", "left join public.prenda_clientes a on a.prenda_id=p.id and a.cliente_id=p_cliente_id and a.puesto_id is not distinct from o.puesto_id and a.renovacion=o.renovacion\n")
t = sub(t, "and not exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.renovacion=a.renovacion)", "and not exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.puesto_id is not distinct from a.puesto_id and f.renovacion=a.renovacion)", 2)
t = sub(t, "'renovacion',a.renovacion,\n    'cantidad',a.cantidad) order by p.codigo_prenda,a.renovacion),'[]'::jsonb) into v_desactivar\n  from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id\n",
        "'renovacion',a.renovacion,\n    'cantidad',a.cantidad,'puesto',(select pu.nombre from public.puestos pu where pu.id=a.puesto_id)) order by p.codigo_prenda,a.renovacion),'[]'::jsonb) into v_desactivar\n  from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id\n")
t = sub(t, "jsonb_build_object('codigo',p.codigo_prenda,'renovacion',a.renovacion,'genero',a.genero,'cantidad',a.cantidad,'activo',a.activo)\n      order by p.codigo_prenda,a.renovacion)",
        "jsonb_build_object('codigo',p.codigo_prenda,'puesto_id',a.puesto_id,'renovacion',a.renovacion,'genero',a.genero,'cantidad',a.cantidad,'activo',a.activo)\n      order by p.codigo_prenda,a.renovacion)")
t = sub(t, "        and a.renovacion=o.renovacion and not o.activo and a.activo;", "        and a.puesto_id is not distinct from o.puesto_id and a.renovacion=o.renovacion and not o.activo and a.activo;")
t = sub(t, "insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,genero,cantidad,activo)\n      select p.id,p_cliente_id,o.renovacion,o.genero,o.cantidad,false from pg_temp.imp_f o\n      join public.prendas p on p.codigo_prenda=o.codigo_prenda where not o.activo\n      on conflict (prenda_id,cliente_id,renovacion)",
        "insert into public.prenda_clientes(prenda_id,cliente_id,puesto_id,renovacion,genero,cantidad,activo)\n      select p.id,p_cliente_id,o.puesto_id,o.renovacion,o.genero,o.cantidad,false from pg_temp.imp_f o\n      join public.prendas p on p.codigo_prenda=o.codigo_prenda where not o.activo\n      on conflict (prenda_id,cliente_id,puesto_id,renovacion)")
t = sub(t, "insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,genero,cantidad,activo)\n      select p.id,p_cliente_id,o.renovacion,o.genero,o.cantidad,true from pg_temp.imp_f o\n      join public.prendas p on p.codigo_prenda=o.codigo_prenda where o.activo\n      on conflict (prenda_id,cliente_id,renovacion)",
        "insert into public.prenda_clientes(prenda_id,cliente_id,puesto_id,renovacion,genero,cantidad,activo)\n      select p.id,p_cliente_id,o.puesto_id,o.renovacion,o.genero,o.cantidad,true from pg_temp.imp_f o\n      join public.prendas p on p.codigo_prenda=o.codigo_prenda where o.activo\n      on conflict (prenda_id,cliente_id,puesto_id,renovacion)")
t = sub(t, "jsonb_build_object('codigo',o.codigo_prenda,'renovacion',o.renovacion,'genero',o.genero,'cantidad',o.cantidad,'activo',o.activo)\n        order by o.fila)", "jsonb_build_object('codigo',o.codigo_prenda,'puesto',o.puesto,'renovacion',o.renovacion,'genero',o.genero,'cantidad',o.cantidad,'activo',o.activo)\n        order by o.fila)")
add(semi(t))

# ===== exportar prendas =====
add("""
create function public.admin_exportar_prendas(p_cliente_id uuid default null) returns jsonb
language plpgsql stable set search_path=pg_catalog,public,pg_temp as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_cliente_id is not null and not exists(select 1 from public.clientes c where c.id=p_cliente_id) then
    raise exception 'Cliente no encontrado' using errcode='P0002'; end if;
  -- Todas las asignaciones (activas e inactivas) y, solo sin filtro de cliente, las prendas sin ninguna asignación (una vez).
  return coalesce((select jsonb_agg(x.j order by x.o1,x.o2,x.o3,x.o4,x.o5) from (
    select jsonb_build_object('codigo_prenda',p.codigo_prenda,'nombre_prenda',p.nombre_prenda,'codigo_almacen',p.codigo_almacen,
        'precio',to_char(p.precio,'FM9999999990.00'),'cantidad',a.cantidad,'cliente',c.nombre,'puesto',pu.nombre,
        'genero',a.genero,'renovacion',a.renovacion,'activo',a.activo) j,
      lower(p.codigo_prenda) o1,lower(c.nombre) o2,lower(coalesce(pu.nombre,'')) o3,a.renovacion o4,a.id::text o5
    from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id join public.clientes c on c.id=a.cliente_id
    left join public.puestos pu on pu.id=a.puesto_id
    where p_cliente_id is null or a.cliente_id=p_cliente_id
    union all
    select jsonb_build_object('codigo_prenda',p.codigo_prenda,'nombre_prenda',p.nombre_prenda,'codigo_almacen',p.codigo_almacen,
        'precio',to_char(p.precio,'FM9999999990.00'),'cantidad',null,'cliente',null,'puesto',null,'genero',null,'renovacion',null,'activo',p.activo),
      lower(p.codigo_prenda),'','','',p.id::text
    from public.prendas p where p_cliente_id is null and not exists(select 1 from public.prenda_clientes a where a.prenda_id=p.id)
  ) x),'[]'::jsonb);
end $$;
revoke all on function public.admin_exportar_prendas(uuid) from public,anon,authenticated;
grant execute on function public.admin_exportar_prendas(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
""")

io.open("supabase/migrations/202611050001_puestos_exportar_prendas.sql", "w", encoding="utf8", newline="\n").write("\n".join(out))
print("ok")
