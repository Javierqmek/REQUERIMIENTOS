"""Genera supabase/migrations/202611060001_cabecera_cargos.sql a partir de las definiciones VIGENTES (base local pgtest con todas las migraciones anteriores)."""
import io, subprocess, sys

PSQL = ["psql", "-h", "localhost", "-p", "55432", "-U", "postgres", "-d", "pgtest", "-At", "-c"]


def defn(sig):
    out = subprocess.run(PSQL + ["select pg_get_functiondef('%s'::regprocedure)" % sig], capture_output=True, check=True).stdout.decode("utf8")
    return out.replace(chr(13), "").strip()


def sub(text, old, new, count=1):
    n = text.count(old)
    if n != count:
        sys.exit("NO COINCIDE (%d veces, esperaba %d): %r" % (n, count, old[:140]))
    return text.replace(old, new)


def semi(t):
    return t.rstrip() + ";\n"


out = []
add = out.append

add("""-- Editar renovación y cargo en requerimientos ya creados + catálogo de cargos.
-- Aplicar después de 202611050001. UNA sola ejecución (todo en una transacción).
--
-- 1. public.cargos (nombre, activo). Carga inicial: AGENTE DIA, AGENTE NOCHE, DESCANSERO, SUPERVISOR y TODOS los valores distintos
--    que hay hoy en personal.cargo (origen='existente'; si un mismo cargo viene escrito con distinta capitalización se unifica
--    con la forma más usada). personal.cargo pasa a referenciar cargos(nombre) (ON UPDATE CASCADE: renombrar un cargo lo
--    actualiza en la ficha de las personas; los requerimientos guardan su propia copia y no cambian).
-- 2. requerimientos.cargo: copia del cargo con el que se pidió (se rellena con el cargo actual del trabajador).
--    Se llena sola al crear; solo cambia con editar_cabecera_requerimiento.
-- 3. editar_cabecera_requerimiento: cambia SOLO la renovación (con la referencia interna RENOVACION ...) y/o el cargo en
--    requerimientos Pendiente u Observado. Si hay prendas que no corresponden a la nueva renovación devuelve la lista y exige
--    confirmarla; al confirmar esas líneas se desactivan (no se borran). Todo queda en requerimiento_cambios.
-- 4. crear_requerimiento recibe el cargo (p_cargo, opcional); importar personal y Mantenimiento → Personal validan contra el catálogo.
begin;

-- ===== 1. catálogo de cargos =====
create table public.cargos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activo boolean not null default true,
  origen text not null default 'manual' check (origen in ('inicial','existente','manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cargos_nombre_valido check (nombre=btrim(nombre) and char_length(nombre) between 1 and 120 and nombre !~ '[\\u0000-\\u001f]'),
  constraint cargos_nombre_uk unique (nombre)
);
create unique index cargos_nombre_ci_uidx on public.cargos(lower(nombre));
alter table public.cargos enable row level security;
create policy cargos_lectura on public.cargos for select to authenticated using (activo or (select public.is_admin()));
revoke all on public.cargos from public,anon,authenticated;
grant select on public.cargos to authenticated;
grant select,insert,update,delete on public.cargos to service_role;

-- Valores que existen hoy: se limpian espacios y se unifica la capitalización con la forma más usada.
update public.personal set cargo='AGENTE' where btrim(cargo)='';
update public.personal set cargo=btrim(cargo) where cargo<>btrim(cargo);
insert into public.cargos(nombre,origen)
  select distinct on (lower(cargo)) cargo,'existente' from (
    select cargo,count(*) n from public.personal group by cargo) t
  order by lower(cargo),n desc,cargo;
update public.personal p set cargo=c.nombre from public.cargos c where lower(c.nombre)=lower(p.cargo) and p.cargo<>c.nombre;
insert into public.cargos(nombre,origen)
  select v,'inicial' from (values ('AGENTE DIA'),('AGENTE NOCHE'),('DESCANSERO'),('SUPERVISOR')) d(v)
  where not exists(select 1 from public.cargos c where lower(c.nombre)=lower(d.v));
do $$ declare v text; begin
  select string_agg(nombre||' ('||(select count(*) from public.personal p where p.cargo=c.nombre)||')',', ' order by nombre) into v
    from public.cargos c where origen='existente';
  raise notice 'Cargos que existían en personal.cargo: %',coalesce(v,'(ninguno)');
end $$;

alter table public.personal add constraint personal_cargo_fkey foreign key (cargo) references public.cargos(nombre) on update cascade on delete restrict deferrable initially deferred;

alter table private.admin_catalog_audit drop constraint admin_catalog_audit_catalogo_check;
alter table private.admin_catalog_audit add constraint admin_catalog_audit_catalogo_check
  check (catalogo in ('clientes','unidades','personal','prendas','provincias','puestos','cargos'));

-- ===== 2. copia del cargo en el requerimiento + historial de cambios =====
alter table public.requerimientos add column cargo text;
-- La relleno con la bandera de edición de cabecera (el trigger de protección aún no conoce la columna).
select set_config('app.edicion_cabecera','on',true);
update public.requerimientos r set cargo=p.cargo from public.personal p where p.id=r.agente_id;
select set_config('app.edicion_cabecera','off',true);

create table public.requerimiento_cambios (
  id uuid primary key default gen_random_uuid(),
  requerimiento_id uuid not null references public.requerimientos(id) on delete cascade,
  usuario_id uuid not null,
  created_at timestamptz not null default now(),
  renovacion_antes text, renovacion_despues text,
  referencia_antes text, referencia_despues text,
  cargo_antes text, cargo_despues text,
  cargo_ficha_antes text,
  lineas_quitadas jsonb not null default '[]'::jsonb
);
create index requerimiento_cambios_req_idx on public.requerimiento_cambios(requerimiento_id,created_at);
alter table public.requerimiento_cambios enable row level security;
create policy requerimiento_cambios_lectura on public.requerimiento_cambios for select to authenticated
  using ((select public.is_admin()) or exists(select 1 from public.requerimientos r where r.id=requerimiento_id and r.usuario_creador_id=auth.uid()));
revoke all on public.requerimiento_cambios from public,anon,authenticated;
grant select on public.requerimiento_cambios to authenticated;
grant select,insert,update,delete on public.requerimiento_cambios to service_role;

""")

# ===== triggers de requerimientos =====
t = defn("public.proteger_requerimiento_actualizado()")
t = sub(t, "    or new.agente_id is distinct from old.agente_id\n",
        "    or new.agente_id is distinct from old.agente_id\n    or (new.cargo is distinct from old.cargo and pg_catalog.current_setting('app.edicion_cabecera',true) is distinct from 'on')\n")
t = sub(t, "    or new.referencia_interna is distinct from old.referencia_interna\n",
        "    or (new.referencia_interna is distinct from old.referencia_interna and pg_catalog.current_setting('app.edicion_cabecera',true) is distinct from 'on')\n")
add(semi(t))

t = defn("public.validar_destino_requerimiento()")
t = sub(t, "  return new;\nend;", "  -- Copia del cargo con el que se pide (si no viene, el actual de la ficha).\n  if new.cargo is null then\n    select p.cargo into new.cargo from public.personal p where p.id=new.agente_id;\n  end if;\n  return new;\nend;")
add(semi(t))

# ===== crear_requerimiento con cargo =====
add("drop function public.crear_requerimiento(uuid,uuid,uuid,text,jsonb,uuid,text,uuid);\n")
t = defn("public.crear_requerimiento(uuid,uuid,uuid,text,jsonb,uuid,text,uuid)")
t = sub(t, "p_puesto_id uuid DEFAULT NULL::uuid)", "p_puesto_id uuid DEFAULT NULL::uuid, p_cargo text DEFAULT NULL::text)")
t = sub(t, "  v_usa boolean;\n", "  v_usa boolean;\n  v_ficha text;\n  v_cargo text;\n")
t = sub(t, "  perform id from public.personal where id=p_agente_id and activo for share;\n  if not found then raise exception 'Agente inválido o inactivo'; end if;\n",
        """  select p.cargo into v_ficha from public.personal p where p.id=p_agente_id and p.activo for update;
  if not found then raise exception 'Agente inválido o inactivo'; end if;
  v_cargo:=v_ficha;
  -- Cargo elegido en el formulario: debe existir y estar activo; si cambia, se actualiza también la ficha del trabajador.
  if p_cargo is not null and lower(btrim(p_cargo)) is distinct from lower(v_ficha) then
    select c.nombre into v_cargo from public.cargos c where lower(c.nombre)=lower(btrim(p_cargo)) and c.activo;
    if not found then raise exception 'El cargo no existe en el catálogo o está inactivo' using errcode='22023'; end if;
    update public.personal set cargo=v_cargo where id=p_agente_id;
    insert into private.admin_catalog_audit(usuario_id,accion,catalogo,registro_id,valores_antes,valores_despues)
      values(auth.uid(),'EDITAR','personal',p_agente_id,jsonb_build_object('cargo',v_ficha),jsonb_build_object('cargo',v_cargo,'origen','crear_requerimiento'));
  end if;
""")
t = sub(t, "insert into public.requerimientos(agente_id,usuario_creador_id,cliente_id,unidad_id,puesto_id,renovacion,referencia_interna,request_id)\n    values(p_agente_id,auth.uid(),p_cliente_id,p_unidad_id,p_puesto_id,p_renovacion,'RENOVACION '||p_renovacion,p_request_id)",
        "insert into public.requerimientos(agente_id,usuario_creador_id,cliente_id,unidad_id,puesto_id,renovacion,referencia_interna,request_id,cargo)\n    values(p_agente_id,auth.uid(),p_cliente_id,p_unidad_id,p_puesto_id,p_renovacion,'RENOVACION '||p_renovacion,p_request_id,v_cargo)")
add(semi(t))
add("revoke all on function public.crear_requerimiento(uuid,uuid,uuid,text,jsonb,uuid,text,uuid,text) from public,anon,authenticated;\ngrant execute on function public.crear_requerimiento(uuid,uuid,uuid,text,jsonb,uuid,text,uuid,text) to authenticated;\n\n")

# ===== listados: incluyen el cargo del requerimiento =====
t = defn("public.listar_requerimientos_filtrados(uuid,uuid,estado_requerimiento,text,integer,integer,integer,integer,text,integer,integer,text,uuid)")
t = sub(t, "r.cliente_id,r.unidad_id,r.puesto_id,\n", "r.cliente_id,r.unidad_id,r.puesto_id,r.cargo,\n")
add(semi(t))
t = defn("public.admin_consultar_requerimientos_v2(uuid,uuid,uuid,estado_requerimiento,timestamp with time zone,timestamp with time zone,text,text,integer,integer,boolean,text,text,integer,integer,boolean,timestamp with time zone,uuid,timestamp with time zone,text,uuid)")
t = sub(t, "r.unidad_id,r.puesto_id,r.usuario_creador_id,\n", "r.unidad_id,r.puesto_id,r.cargo,r.usuario_creador_id,\n")
add(semi(t))

# ===== catálogos =====
t = defn("public.admin_listar_catalogo(text,text,uuid,text,integer,integer)")
t = sub(t, "p_catalogo not in ('clientes','unidades','personal','prendas','provincias','puestos')", "p_catalogo not in ('clientes','unidades','personal','prendas','provincias','puestos','cargos')")
t = sub(t, "    when 'puestos' then\n",
        """    when 'cargos' then
      select count(*) into v_total from public.cargos c where v_q='' or position(v_q in lower(c.nombre))>0;
      select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre,x.id),'[]') into v_rows from (
        select c.id,c.nombre,c.activo,(select count(*) from public.personal p where p.cargo=c.nombre) personas
        from public.cargos c where v_q='' or position(v_q in lower(c.nombre))>0
        order by c.nombre,c.id limit p_limite offset p_offset) x;
    when 'puestos' then
""")
add(semi(t))

t = defn("private.admin_guardar_catalogo(text,uuid,jsonb)")
t = sub(t, "  v_usa boolean; v_puesto_id uuid;", "  v_cargo_n text; v_usa boolean; v_puesto_id uuid;")
t = sub(t, "p_catalogo not in ('clientes','unidades','personal','prendas','provincias','puestos') or p_valores is null", "p_catalogo not in ('clientes','unidades','personal','prendas','provincias','puestos','cargos') or p_valores is null")
t = sub(t, "    when 'puestos' then\n      if (p_valores-'nombre'-'cliente_id')",
        """    when 'cargos' then
      if (p_valores-'nombre')<>'{}'::jsonb then raise exception 'Campos de cargo inválidos' using errcode='22023'; end if;
      v_nombre:=btrim(p_valores->>'nombre');
      if nullif(v_nombre,'') is null or length(v_nombre)>120 or v_nombre~'[\\u0000-\\u001f]' then
        raise exception 'El nombre del cargo es obligatorio y admite hasta 120 caracteres' using errcode='22023';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('cargo:'||lower(v_nombre),0));
      if exists(select 1 from public.cargos c where lower(c.nombre)=lower(v_nombre) and c.id is distinct from p_id) then
        raise exception 'Ya existe un cargo con ese nombre' using errcode='23505';
      end if;
      if p_id is null then
        insert into public.cargos(nombre,activo,origen) values(v_nombre,true,'manual') returning to_jsonb(cargos.*) into v_despues;
      else
        select to_jsonb(c.*) into v_antes from public.cargos c where c.id=p_id for update;
        if v_antes is null then raise exception 'Cargo no encontrado' using errcode='P0002'; end if;
        -- Renombrar actualiza la ficha de las personas (ON UPDATE CASCADE); los requerimientos conservan su copia.
        update public.cargos set nombre=v_nombre,updated_at=now() where id=p_id returning to_jsonb(cargos.*) into v_despues;
      end if;

    when 'puestos' then
      if (p_valores-'nombre'-'cliente_id')""")
t = sub(t, "        raise exception 'Revisa código, nombre, DNI (exactamente 8 dígitos) y cargo' using errcode='22023';\n      end if;\n",
        """        raise exception 'Revisa código, nombre, DNI (exactamente 8 dígitos) y cargo' using errcode='22023';
      end if;
      -- El cargo debe existir en el catálogo y estar activo (o ser el que la persona ya tiene).
      select c.nombre into v_cargo_n from public.cargos c where lower(c.nombre)=lower(btrim(p_valores->>'cargo'))
        and (c.activo or c.nombre=(select p.cargo from public.personal p where p.id=p_id));
      if not found then raise exception 'El cargo no existe en el catálogo de cargos o está inactivo' using errcode='22023'; end if;
""")
t = sub(t, "values(v_codigo,v_nombre,p_valores->>'dni',btrim(p_valores->>'cargo'),true)", "values(v_codigo,v_nombre,p_valores->>'dni',v_cargo_n,true)")
t = sub(t, "dni=p_valores->>'dni',cargo=btrim(p_valores->>'cargo')", "dni=p_valores->>'dni',cargo=v_cargo_n")
add(semi(t))

t = defn("private.admin_actualizar_catalogo_activo(text,uuid,boolean)")
t = sub(t, "p_catalogo not in ('clientes','unidades','personal','prendas','provincias','puestos')", "p_catalogo not in ('clientes','unidades','personal','prendas','provincias','puestos','cargos')")
t = sub(t, "    when 'puestos' then select to_jsonb(pu.*) into v_antes from public.puestos pu where pu.id=p_id for update;\n",
        "    when 'puestos' then select to_jsonb(pu.*) into v_antes from public.puestos pu where pu.id=p_id for update;\n    when 'cargos' then select to_jsonb(c.*) into v_antes from public.cargos c where c.id=p_id for update;\n")
t = sub(t, "    when 'puestos' then update public.puestos set activo=p_activo where id=p_id returning to_jsonb(puestos.*) into v_despues;\n",
        "    when 'puestos' then update public.puestos set activo=p_activo where id=p_id returning to_jsonb(puestos.*) into v_despues;\n    when 'cargos' then update public.cargos set activo=p_activo,updated_at=now() where id=p_id returning to_jsonb(cargos.*) into v_despues;\n")
add(semi(t))

# ===== importación de personal: cargo contra el catálogo =====
t = defn("private.admin_importar_personal(jsonb,boolean,jsonb,text)")
t = sub(t, "  v_cargo text:=btrim(coalesce(p_cargo_defecto,''));\n", "  v_cargo text:=btrim(coalesce(p_cargo_defecto,''));\n")
t = sub(t, "  perform pg_advisory_xact_lock(hashtextextended('importar_personal',0));\n",
        "  perform pg_advisory_xact_lock(hashtextextended('importar_personal',0));\n  v_cargo:=coalesce((select c.nombre from public.cargos c where lower(c.nombre)=lower(v_cargo)),v_cargo);\n")
t = sub(t, "  select coalesce(jsonb_agg(jsonb_build_object('fila',e.fila,'codigo',e.codigo,'mensaje',e.mensaje) order by e.fila),'[]'::jsonb)\n    into v_err from pg_temp.imp_e e;",
        """  -- Cargos: el del archivo (o el cargo por defecto de las personas nuevas) debe existir y estar activo en el catálogo.
  update pg_temp.imp_mt m set cargo=c.nombre from public.cargos c where m.cargo is not null and lower(c.nombre)=lower(m.cargo);
  insert into pg_temp.imp_e
    select m.fila,m.codigo,'El cargo "'||coalesce(m.cargo,v_cargo)||'" no existe en el catálogo de cargos o está inactivo'
    from pg_temp.imp_mt m
    where (m.cargo is not null or m.pid is null)
      and not (m.pid is not null and lower(btrim(m.cargo_act))=lower(m.cargo))
      and not exists(select 1 from public.cargos c where c.nombre=coalesce(m.cargo,v_cargo) and c.activo);
  select coalesce(jsonb_agg(jsonb_build_object('fila',e.fila,'codigo',e.codigo,'mensaje',e.mensaje) order by e.fila,e.mensaje),'[]'::jsonb)
    into v_err from pg_temp.imp_e e;""")
add(semi(t))

# ===== editar_cabecera_requerimiento =====
add("""
create function public.editar_cabecera_requerimiento(p_id uuid, p_renovacion text default null, p_cargo text default null, p_lineas_confirmadas uuid[] default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  v_row public.requerimientos; v_ficha text; v_cargo text; v_ids uuid[]; v_lineas jsonb;
  v_ren text; v_cambia_ren boolean; v_cambia_cargo boolean; v_ref text;
begin
  -- Mismas reglas que la edición de prendas: admin/superadmin cualquiera; coordinador solo los suyos. Bloquea la cabecera.
  select r.* into v_row from public.requerimientos r
    join public.profiles p on p.id=auth.uid()
    where r.id=p_id and (p.role in ('admin','superadmin') or (p.role='coordinador' and r.usuario_creador_id=p.id))
    for update of r;
  if not found then raise exception 'No autorizado' using errcode='42501'; end if;
  if v_row.estado not in ('Pendiente','Observado') then
    raise exception 'Este requerimiento ya fue atendido y no puede modificarse.' using errcode='55000';
  end if;
  if p_renovacion is null and p_cargo is null then raise exception 'No hay cambios que guardar' using errcode='22023'; end if;
  if p_renovacion is not null and p_renovacion not in ('VERANO','INVIERNO') then
    raise exception 'La renovación debe ser Verano o Invierno' using errcode='22023'; end if;
  if p_lineas_confirmadas is not null and cardinality(p_lineas_confirmadas)>500 then
    raise exception 'Solicitud inválida' using errcode='22023'; end if;
  select p.cargo into v_ficha from public.personal p where p.id=v_row.agente_id for update;
  v_ren:=coalesce(p_renovacion,v_row.renovacion);
  v_cambia_ren:=v_ren<>v_row.renovacion;

  -- Cargo: debe existir y estar activo, salvo que no cambie nada (ni la copia ni la ficha).
  v_cargo:=null; v_cambia_cargo:=false;
  if p_cargo is not null then
    select c.nombre into v_cargo from public.cargos c where lower(c.nombre)=lower(btrim(p_cargo));
    if not found then raise exception 'El cargo no existe en el catálogo de cargos' using errcode='22023'; end if;
    v_cambia_cargo:=v_cargo is distinct from v_row.cargo or v_cargo is distinct from v_ficha;
    if v_cambia_cargo and not exists(select 1 from public.cargos c where c.nombre=v_cargo and c.activo) then
      raise exception 'El cargo está inactivo: elige un cargo activo' using errcode='22023'; end if;
  end if;

  -- Renovación: líneas activas cuya prenda no está asignada (activa) a este cliente y puesto para la nueva renovación o AMBOS.
  v_lineas:='[]'::jsonb; v_ids:='{}';
  if v_cambia_ren then
    if v_row.cliente_id is null then
      raise exception 'Este requerimiento histórico no tiene cliente: no se puede cambiar su renovación' using errcode='55000'; end if;
    select coalesce(array_agg(x.id order by x.created_at,x.id),'{}'),
           coalesce(jsonb_agg(jsonb_build_object('id',x.id,'prenda_id',x.prenda_id,'codigo',x.codigo_prenda,'nombre',x.nombre_prenda,'cantidad',x.cantidad)
             order by x.created_at,x.id),'[]'::jsonb)
      into v_ids,v_lineas
      from (select d.id,d.created_at,d.prenda_id,d.cantidad,g.codigo_prenda,g.nombre_prenda
        from public.detalle_requerimiento d join public.prendas g on g.id=d.prenda_id
        where d.requerimiento_id=p_id and d.activo and not exists(
          select 1 from public.prenda_clientes a where a.prenda_id=d.prenda_id and a.cliente_id=v_row.cliente_id and a.activo
            and a.puesto_id is not distinct from v_row.puesto_id and a.renovacion in (v_ren,'AMBOS'))) x;
    if cardinality(v_ids)>0 and (p_lineas_confirmadas is null
      or (select array_agg(i order by i) from unnest(p_lineas_confirmadas) i) is distinct from (select array_agg(i order by i) from unnest(v_ids) i)) then
      -- Nada se modifica: la pantalla muestra la lista y vuelve a llamar confirmándola.
      return jsonb_build_object('requiere_confirmacion',true,'lineas',v_lineas);
    end if;
  end if;

  if not v_cambia_ren and not v_cambia_cargo then
    return jsonb_build_object('ok',true,'sin_cambios',true,'data',public.obtener_edicion_prendas(p_id));
  end if;

  v_ref:=case when v_cambia_ren then 'RENOVACION '||v_ren else v_row.referencia_interna end;
  perform pg_catalog.set_config('app.edicion_cabecera','on',true);
  update public.requerimientos set renovacion=v_ren,referencia_interna=v_ref,cargo=case when v_cambia_cargo then v_cargo else cargo end where id=p_id;
  perform pg_catalog.set_config('app.edicion_cabecera','off',true);
  if cardinality(v_ids)>0 then
    update public.detalle_requerimiento d set activo=false,retirado_at=clock_timestamp(),retirado_por=auth.uid()
      where d.requerimiento_id=p_id and d.activo and d.id=any(v_ids);
  end if;
  if v_cambia_cargo and v_cargo is distinct from v_ficha then
    update public.personal set cargo=v_cargo where id=v_row.agente_id;
    insert into private.admin_catalog_audit(usuario_id,accion,catalogo,registro_id,valores_antes,valores_despues)
      values(auth.uid(),'EDITAR','personal',v_row.agente_id,jsonb_build_object('cargo',v_ficha),
        jsonb_build_object('cargo',v_cargo,'origen','editar_requerimiento','requerimiento_id',p_id));
  end if;
  insert into public.requerimiento_cambios(requerimiento_id,usuario_id,renovacion_antes,renovacion_despues,referencia_antes,referencia_despues,
      cargo_antes,cargo_despues,cargo_ficha_antes,lineas_quitadas)
    values(p_id,auth.uid(),case when v_cambia_ren then v_row.renovacion end,case when v_cambia_ren then v_ren end,
      case when v_cambia_ren then v_row.referencia_interna end,case when v_cambia_ren then v_ref end,
      case when v_cambia_cargo then v_row.cargo end,case when v_cambia_cargo then v_cargo end,case when v_cambia_cargo then v_ficha end,v_lineas);
  return jsonb_build_object('ok',true,'data',public.obtener_edicion_prendas(p_id));
end $$;
revoke all on function public.editar_cabecera_requerimiento(uuid,text,text,uuid[]) from public,anon,authenticated;
grant execute on function public.editar_cabecera_requerimiento(uuid,text,text,uuid[]) to authenticated;

notify pgrst,'reload schema';
commit;
""")
io.open("supabase/migrations/202611060001_cabecera_cargos.sql", "w", encoding="utf8", newline="\n").write("\n".join(out))
print("ok")
