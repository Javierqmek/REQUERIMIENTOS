-- Prendas por puesto (solo para clientes que lo activan, p. ej. BCR) y exportación de prendas.
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
  constraint puestos_nombre_valido check (nombre=btrim(nombre) and char_length(nombre) between 1 and 200 and nombre !~ '[\u0000-\u001f]'),
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


CREATE OR REPLACE FUNCTION public.proteger_requerimiento_actualizado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
  if new.id is distinct from old.id or new.fecha is distinct from old.fecha
    or new.agente_id is distinct from old.agente_id
    or new.usuario_creador_id is distinct from old.usuario_creador_id
    or new.cliente_id is distinct from old.cliente_id
    or new.unidad_id is distinct from old.unidad_id
    or new.puesto_id is distinct from old.puesto_id
    or new.referencia_interna is distinct from old.referencia_interna
    or new.created_at is distinct from old.created_at then
    raise exception 'Solo se permite cambiar el estado';
  end if;
  return new;
end;
$function$;


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


CREATE OR REPLACE FUNCTION private.prenda_json(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  select to_jsonb(p.*) || jsonb_build_object('asignaciones',coalesce((
    select jsonb_agg(jsonb_build_object('id',a.id,'cliente_id',a.cliente_id,'cliente',c.nombre,'puesto_id',a.puesto_id,'puesto',pu.nombre,'renovacion',a.renovacion,
      'genero',a.genero,'cantidad',a.cantidad,'activo',a.activo) order by c.nombre,pu.nombre nulls first,a.renovacion)
    from public.prenda_clientes a join public.clientes c on c.id=a.cliente_id
    left join public.puestos pu on pu.id=a.puesto_id where a.prenda_id=p.id),'[]'::jsonb))
  from public.prendas p where p.id=p_id;
$function$;

drop function public.listar_prendas_cliente(uuid,text);

create function public.listar_prendas_cliente(p_cliente_id uuid, p_renovacion text, p_puesto_id uuid default null)
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


drop function public.crear_requerimiento(uuid,uuid,uuid,text,jsonb,uuid,text);

CREATE OR REPLACE FUNCTION public.crear_requerimiento(p_agente_id uuid, p_cliente_id uuid, p_unidad_id uuid, p_renovacion text, p_detalles jsonb, p_request_id uuid, p_genero text, p_puesto_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_id uuid;
  v_cliente text;
  v_usa boolean;
  v_prendas uuid[];
  v_count integer;
begin
  if auth.uid() is null or p_request_id is null or not exists(
    select 1 from public.profiles where id=auth.uid() and role in ('admin','superadmin','coordinador')) then
    raise exception 'Solicitud no autorizada o incompleta' using errcode='42501';
  end if;
  if p_renovacion is null or p_renovacion not in ('VERANO','INVIERNO') then
    raise exception 'Selecciona el tipo de renovación (Verano o Invierno)' using errcode='22023';
  end if;
  if p_genero is null or p_genero not in ('HOMBRE','MUJER') then
    raise exception 'Selecciona el género de las prendas (Hombre o Mujer)' using errcode='22023';
  end if;
  -- Serializa únicamente reintentos de la misma solicitud del mismo usuario.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text || ':' || p_request_id::text,0));
  select r.id into v_id from public.requerimientos r
    where r.usuario_creador_id=auth.uid() and r.request_id=p_request_id;
  if found then return v_id; end if;
  perform id from public.personal where id=p_agente_id and activo for share;
  if not found then raise exception 'Agente inválido o inactivo'; end if;
  select nombre,diferencia_puestos into v_cliente,v_usa from public.clientes where id=p_cliente_id and activo for share;
  if not found then raise exception 'Selecciona un cliente activo'; end if;
  if v_usa and p_puesto_id is null then raise exception 'Selecciona el puesto' using errcode='22023'; end if;
  if not v_usa and p_puesto_id is not null then raise exception 'El cliente no diferencia prendas por puesto' using errcode='22023'; end if;
  if p_puesto_id is not null then
    perform 1 from public.puestos pu where pu.id=p_puesto_id and pu.cliente_id=p_cliente_id and pu.activo for share;
    if not found then raise exception 'Selecciona un puesto activo del cliente' using errcode='22023'; end if;
  end if;
  perform id from public.unidades where id=p_unidad_id and cliente_id=p_cliente_id and activo for share;
  if not found then raise exception 'Selecciona una unidad activa del cliente'; end if;
  if p_detalles is null or jsonb_typeof(p_detalles)<>'array' then raise exception 'Debe incluir prendas'; end if;
  if jsonb_array_length(p_detalles)=0 then raise exception 'Debe incluir prendas'; end if;
  if jsonb_array_length(p_detalles)>500 or octet_length(p_detalles::text)>131072 then
    raise exception 'Demasiadas prendas' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_detalles) x
    where jsonb_typeof(x)<>'object' or not (x ? 'prenda_id') or (x - 'prenda_id')<>'{}'::jsonb) then
    raise exception 'Solo se aceptan identificadores de prendas' using errcode='22023';
  end if;
  select array_agg(x.prenda_id),count(distinct x.prenda_id)
    into v_prendas,v_count from jsonb_to_recordset(p_detalles) as x(prenda_id uuid);
  -- Cada prenda solo una vez por requerimiento: si hace falta más, se sube la cantidad.
  if v_count<>jsonb_array_length(p_detalles) then
    raise exception 'Detalles inválidos o duplicados' using errcode='22023';
  end if;
  -- Cada prenda debe estar asignada (activa) a ESTE cliente y a esta renovación (o AMBOS). Se mantiene
  -- estable la ficha y la asignación mientras se copian cantidad/precio/código.
  perform 1 from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id
    where a.prenda_id=any(v_prendas) and a.cliente_id=p_cliente_id and a.activo and p.activo
      and a.puesto_id is not distinct from p_puesto_id
      and a.renovacion in (p_renovacion,'AMBOS') and a.genero in (p_genero,'AMBOS')
    order by a.id for share of a,p;
  get diagnostics v_count=row_count;
  if v_count<>cardinality(v_prendas) then
    raise exception 'La prenda no corresponde al cliente, el puesto, la renovación ni el género seleccionados, o está inactiva' using errcode='22023';
  end if;
  insert into public.requerimientos(agente_id,usuario_creador_id,cliente_id,unidad_id,puesto_id,renovacion,referencia_interna,request_id)
    values(p_agente_id,auth.uid(),p_cliente_id,p_unidad_id,p_puesto_id,p_renovacion,'RENOVACION '||p_renovacion,p_request_id) returning id into v_id;
  insert into public.detalle_requerimiento(requerimiento_id,prenda_id,cantidad,precio_unitario,codigo_almacen)
    select v_id,p.id,a.cantidad,p.precio,p.codigo_almacen from public.prendas p
    join public.prenda_clientes a on a.prenda_id=p.id and a.cliente_id=p_cliente_id and a.activo
      and a.puesto_id is not distinct from p_puesto_id
      and a.renovacion in (p_renovacion,'AMBOS') and a.genero in (p_genero,'AMBOS')
    where p.id=any(v_prendas);
  return v_id;
end;
$function$;

revoke all on function public.crear_requerimiento(uuid,uuid,uuid,text,jsonb,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.crear_requerimiento(uuid,uuid,uuid,text,jsonb,uuid,text,uuid) to authenticated;


CREATE OR REPLACE FUNCTION public.obtener_edicion_prendas(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.requerimientos; v_details jsonb; v_header jsonb;
begin
  select r.* into v_row from public.requerimientos r
    join public.profiles p on p.id=auth.uid()
    where r.id=p_id and (p.role in ('admin','superadmin') or (p.role='coordinador' and r.usuario_creador_id=p.id));
  if not found then raise exception 'No autorizado' using errcode='42501'; end if;
  -- 'prendas' trae la cantidad y renovación de la asignación vigente (si ya no existe, la de la línea).
  select coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object('prendas',to_jsonb(g) ||
      jsonb_build_object('cantidad',coalesce(a.cantidad,d.cantidad),'renovacion',coalesce(a.renovacion,v_row.renovacion),'genero',coalesce(a.genero,'AMBOS')))
      order by d.created_at,d.id),'[]') into v_details
    from public.detalle_requerimiento d join public.prendas g on g.id=d.prenda_id
    left join public.prenda_clientes a on a.prenda_id=g.id and a.cliente_id=v_row.cliente_id and a.activo
      and a.puesto_id is not distinct from v_row.puesto_id and a.renovacion in (v_row.renovacion,'AMBOS')
    where d.requerimiento_id=p_id and d.activo;
  select to_jsonb(r) || jsonb_build_object(
      'personal',jsonb_build_object('nombre',p.nombre,'dni',p.dni,'cargo',p.cargo),
      'clientes',case when c.id is not null then jsonb_build_object('nombre',c.nombre) end,
      'unidades',case when u.id is not null then jsonb_build_object('nombre',u.nombre) end,
      'puestos',case when pu.id is not null then jsonb_build_object('nombre',pu.nombre) end,
      'detalle_requerimiento',v_details) into v_header
    from public.requerimientos r join public.personal p on p.id=r.agente_id
    left join public.clientes c on c.id=r.cliente_id
    left join public.unidades u on u.id=r.unidad_id left join public.puestos pu on pu.id=r.puesto_id where r.id=p_id;
  return jsonb_build_object('requerimiento',v_header,'version',md5(v_details::text));
end $function$;

CREATE OR REPLACE FUNCTION public.editar_prendas_requerimiento(p_id uuid, p_version text, p_detalles jsonb, p_genero text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v_row public.requerimientos; v_payload jsonb; v_cliente text; v_count integer; v_ids uuid[];
begin
  -- Bloqueo de cabecera serializa edición con cualquier cambio de estado.
  select r.* into v_row from public.requerimientos r
    join public.profiles p on p.id=auth.uid()
    where r.id=p_id and (p.role in ('admin','superadmin') or (p.role='coordinador' and r.usuario_creador_id=p.id))
    for update of r;
  if not found then raise exception 'No autorizado' using errcode='42501'; end if;
  if v_row.estado='Atendido' then
    raise exception 'Este requerimiento ya fue atendido y no puede modificarse.' using errcode='55000';
  end if;
  if p_genero is not null and p_genero not in ('HOMBRE','MUJER') then
    raise exception 'Género inválido' using errcode='22023';
  end if;
  if p_detalles is null or jsonb_typeof(p_detalles)<>'array' then
    raise exception 'Incluye al menos una prenda' using errcode='22023';
  end if;
  if octet_length(p_detalles::text)>131072 then
    raise exception 'Solicitud demasiado grande' using errcode='22023';
  end if;
  if jsonb_array_length(p_detalles)<1 or jsonb_array_length(p_detalles)>500 then
    raise exception 'Incluye entre 1 y 500 prendas' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_detalles) x
    where jsonb_typeof(x)<>'object' or not (x ? 'prenda_id')
      or (x - 'prenda_id' - 'detalle_id')<>'{}'::jsonb) then
    raise exception 'Solo se aceptan identificadores de prendas y líneas' using errcode='22023';
  end if;
  select array_agg(x.prenda_id),count(distinct x.prenda_id) into v_ids,v_count
    from jsonb_to_recordset(p_detalles) as x(prenda_id uuid,detalle_id uuid);
  if v_count<>jsonb_array_length(p_detalles) then
    raise exception 'Prendas inválidas o duplicadas' using errcode='22023';
  end if;
  -- Fija el maestro antes de calcular la versión; detecta cambios desde la carga.
  perform g.id from public.prendas g where g.id=any(v_ids) or exists(
    select 1 from public.detalle_requerimiento d where d.requerimiento_id=p_id and d.activo and d.prenda_id=g.id)
    order by g.id for share;
  perform a.id from public.prenda_clientes a where a.cliente_id=v_row.cliente_id and a.prenda_id=any(v_ids)
    order by a.id for share;
  v_payload:=public.obtener_edicion_prendas(p_id);
  if p_version is distinct from (v_payload->>'version') then
    raise exception 'El requerimiento o el maestro cambió. Recarga la página antes de guardar.' using errcode='40001';
  end if;
  select nombre into v_cliente from public.clientes where id=v_row.cliente_id for share;
  if exists(select 1 from jsonb_to_recordset(p_detalles) as x(prenda_id uuid,detalle_id uuid)
    where x.detalle_id is not null and not exists(
      select 1 from public.detalle_requerimiento d where d.id=x.detalle_id
        and d.requerimiento_id=p_id and d.prenda_id=x.prenda_id and d.activo)) then
    raise exception 'La línea no está activa o no pertenece al requerimiento' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_to_recordset(p_detalles) as x(prenda_id uuid,detalle_id uuid)
    where x.detalle_id is null and not exists(select 1 from public.prendas g join public.prenda_clientes a on a.prenda_id=g.id
      where g.id=x.prenda_id and g.activo and a.activo and a.cliente_id=v_row.cliente_id
        and a.puesto_id is not distinct from v_row.puesto_id and a.renovacion in (v_row.renovacion,'AMBOS') and (p_genero is null or a.genero in (p_genero,'AMBOS')))) then
    raise exception 'La prenda no corresponde al cliente, el puesto, la renovación ni el género, o está inactiva' using errcode='22023';
  end if;
  -- Retirar primero permite sustituir una línea por otra de la misma prenda.
  update public.detalle_requerimiento d
    set activo=false,retirado_at=clock_timestamp(),retirado_por=auth.uid()
    where d.requerimiento_id=p_id and d.activo and not exists(
      select 1 from jsonb_to_recordset(p_detalles) as x(prenda_id uuid,detalle_id uuid) where x.detalle_id=d.id);
  -- Solo cantidad proviene del maestro; precio/código de líneas conservadas no cambian.
  update public.detalle_requerimiento d set cantidad=a.cantidad from public.prenda_clientes a
    where d.requerimiento_id=p_id and d.activo and a.prenda_id=d.prenda_id and a.cliente_id=v_row.cliente_id
      and a.puesto_id is not distinct from v_row.puesto_id and a.activo and a.renovacion in (v_row.renovacion,'AMBOS');
  insert into public.detalle_requerimiento(requerimiento_id,prenda_id,cantidad,precio_unitario,codigo_almacen)
    select p_id,g.id,a.cantidad,g.precio,g.codigo_almacen
    from jsonb_to_recordset(p_detalles) as x(prenda_id uuid,detalle_id uuid)
    join public.prendas g on g.id=x.prenda_id
    join public.prenda_clientes a on a.prenda_id=g.id and a.cliente_id=v_row.cliente_id and a.activo
      and a.puesto_id is not distinct from v_row.puesto_id and a.renovacion in (v_row.renovacion,'AMBOS')
    where x.detalle_id is null;
  return public.obtener_edicion_prendas(p_id);
end $function$;

drop function public.listar_requerimientos_filtrados(uuid,uuid,estado_requerimiento,text,integer,integer,integer,integer,text,integer,integer,text);

CREATE OR REPLACE FUNCTION public.listar_requerimientos_filtrados(p_cliente_id uuid DEFAULT NULL::uuid, p_unidad_id uuid DEFAULT NULL::uuid, p_estado estado_requerimiento DEFAULT NULL::estado_requerimiento, p_genero text DEFAULT NULL::text, p_prendas_min integer DEFAULT NULL::integer, p_prendas_max integer DEFAULT NULL::integer, p_unidades_min integer DEFAULT NULL::integer, p_unidades_max integer DEFAULT NULL::integer, p_busqueda text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0, p_renovacion text DEFAULT NULL::text, p_puesto_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_genero is not null and p_genero not in ('HOMBRE','MUJER','AMBOS') then raise exception 'Género inválido' using errcode='22023'; end if;
  if p_renovacion is not null and p_renovacion not in ('VERANO','INVIERNO') then raise exception 'Renovación inválida' using errcode='22023'; end if;
  if length(p_busqueda)>120 or p_limite is null or p_limite<1 or p_limite>100 or p_offset is null or p_offset<0 or p_offset>500000 then
    raise exception 'Paginación inválida' using errcode='22023';
  end if;
  if coalesce(p_prendas_min,0)<0 or coalesce(p_prendas_max,0)<0 or coalesce(p_unidades_min,0)<0 or coalesce(p_unidades_max,0)<0
    or p_prendas_min>5000 or p_prendas_max>5000 or p_unidades_min>5000 or p_unidades_max>5000
    or (p_prendas_min is not null and p_prendas_max is not null and p_prendas_min>p_prendas_max)
    or (p_unidades_min is not null and p_unidades_max is not null and p_unidades_min>p_unidades_max) then
    raise exception 'Rango inválido' using errcode='22023';
  end if;
  with rows as materialized (
    select r.id,r.fecha,r.referencia_interna,r.estado,r.renovacion,r.usuario_creador_id,r.cliente_id,r.unidad_id,r.puesto_id,
      case when p.id is not null then jsonb_build_object('nombre',p.nombre,'dni',p.dni,'cargo',p.cargo) end personal,
      case when c.id is not null then jsonb_build_object('nombre',c.nombre) end clientes,
      case when u.id is not null then jsonb_build_object('nombre',u.nombre) end unidades,
      case when pu.id is not null then jsonb_build_object('nombre',pu.nombre) end puestos,
      coalesce(d.cantidad_prendas,0) cantidad_prendas,coalesce(d.unidades_totales,0) unidades_totales,
      coalesce(d.total_requerimiento,0) total_requerimiento,coalesce(d.generos,'{}'::text[]) generos
    from public.requerimientos r
    left join public.personal p on p.id=r.agente_id left join public.clientes c on c.id=r.cliente_id
    left join public.unidades u on u.id=r.unidad_id left join public.puestos pu on pu.id=r.puesto_id
    left join lateral (
      select count(*)::integer cantidad_prendas,coalesce(sum(dr.cantidad),0)::integer unidades_totales,
        coalesce(sum(dr.cantidad*dr.precio_unitario),0)::numeric total_requerimiento,
        coalesce(array_agg(distinct g.genero) filter(where g.genero is not null),'{}'::text[]) generos
      from public.detalle_requerimiento dr left join lateral (select a.genero from public.prenda_clientes a where a.prenda_id=dr.prenda_id and a.cliente_id=r.cliente_id and a.puesto_id is not distinct from r.puesto_id and a.renovacion in (r.renovacion,'AMBOS') order by a.activo desc,a.updated_at desc limit 1) g on true
      where dr.requerimiento_id=r.id and dr.activo
    ) d on true where r.usuario_creador_id=auth.uid()
  ), filtered as (
    select * from rows x where (p_cliente_id is null or x.cliente_id=p_cliente_id)
      and (p_unidad_id is null or x.unidad_id=p_unidad_id) and (p_estado is null or x.estado=p_estado)
      and (p_renovacion is null or x.renovacion=p_renovacion) and (p_puesto_id is null or x.puesto_id=p_puesto_id)
      and (p_prendas_min is null or x.cantidad_prendas>=p_prendas_min) and (p_prendas_max is null or x.cantidad_prendas<=p_prendas_max)
      and (p_unidades_min is null or x.unidades_totales>=p_unidades_min) and (p_unidades_max is null or x.unidades_totales<=p_unidades_max)
      and (p_genero is null or (p_genero='HOMBRE' and x.generos&&array['HOMBRE','AMBOS'])
        or (p_genero='MUJER' and x.generos&&array['MUJER','AMBOS']) or (p_genero='AMBOS' and 'AMBOS'=any(x.generos)))
      and (nullif(trim(p_busqueda),'') is null or position(lower(trim(p_busqueda)) in lower(concat_ws(' ',x.personal->>'nombre',x.personal->>'dni',x.clientes->>'nombre',x.unidades->>'nombre',x.puestos->>'nombre',x.referencia_interna,x.id::text)))>0)
  )
  select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(x) order by x.fecha desc,x.id desc)
    from (select * from filtered order by fecha desc,id desc limit p_limite offset p_offset) x),'[]'::jsonb)) into v_result;
  return v_result;
end $function$;

revoke all on function public.listar_requerimientos_filtrados(uuid,uuid,estado_requerimiento,text,integer,integer,integer,integer,text,integer,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.listar_requerimientos_filtrados(uuid,uuid,estado_requerimiento,text,integer,integer,integer,integer,text,integer,integer,text,uuid) to authenticated;


drop function public.admin_consultar_requerimientos_v2(uuid,uuid,uuid,estado_requerimiento,timestamp with time zone,timestamp with time zone,text,text,integer,integer,boolean,text,text,integer,integer,boolean,timestamp with time zone,uuid,timestamp with time zone,text);

CREATE OR REPLACE FUNCTION public.admin_consultar_requerimientos_v2(p_cliente_id uuid DEFAULT NULL::uuid, p_unidad_id uuid DEFAULT NULL::uuid, p_coordinador_id uuid DEFAULT NULL::uuid, p_estado estado_requerimiento DEFAULT NULL::estado_requerimiento, p_desde timestamp with time zone DEFAULT NULL::timestamp with time zone, p_hasta timestamp with time zone DEFAULT NULL::timestamp with time zone, p_busqueda text DEFAULT NULL::text, p_genero text DEFAULT NULL::text, p_unidades_min integer DEFAULT NULL::integer, p_unidades_max integer DEFAULT NULL::integer, p_solo_duplicados boolean DEFAULT false, p_orden text DEFAULT 'fecha'::text, p_direccion text DEFAULT 'desc'::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0, p_exportar boolean DEFAULT false, p_cursor_fecha timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_creado_hasta timestamp with time zone DEFAULT NULL::timestamp with time zone, p_renovacion text DEFAULT NULL::text, p_puesto_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_orden not in ('fecha','agente','cliente','unidad','coordinador','estado','prendas','total') or p_direccion not in ('asc','desc') then raise exception 'Orden inválido' using errcode='22023'; end if;
  if p_genero is not null and p_genero not in ('HOMBRE','MUJER','AMBOS') then raise exception 'Género inválido' using errcode='22023'; end if;
  if p_renovacion is not null and p_renovacion not in ('VERANO','INVIERNO') then raise exception 'Renovación inválida' using errcode='22023'; end if;
  if length(p_busqueda)>120 or p_limite is null or p_limite<1 or p_limite>250 or p_offset is null or p_offset<0 or p_offset>49999950 then raise exception 'Paginación inválida' using errcode='22023'; end if;
  if coalesce(p_unidades_min,0)<0 or coalesce(p_unidades_max,0)<0 or p_unidades_min>5000 or p_unidades_max>5000
    or (p_unidades_min is not null and p_unidades_max is not null and p_unidades_min>p_unidades_max) then raise exception 'Rango de unidades inválido' using errcode='22023'; end if;
  if (p_cursor_fecha is null)<>(p_cursor_id is null) then raise exception 'Cursor incompleto' using errcode='22023'; end if;
  if p_desde is not null and p_hasta is not null and p_desde>=p_hasta then raise exception 'Rango inválido' using errcode='22023'; end if;
  with all_rows as materialized (
    select r.id,r.fecha,r.created_at,r.referencia_interna,r.estado,r.renovacion,r.agente_id,r.cliente_id,r.unidad_id,r.puesto_id,r.usuario_creador_id,
      jsonb_build_object('nombre',p.nombre,'dni',p.dni,'cargo',p.cargo) personal,
      case when c.id is not null then jsonb_build_object('nombre',c.nombre) end clientes,
      case when u.id is not null then jsonb_build_object('nombre',u.nombre) end unidades,
      case when pu.id is not null then jsonb_build_object('nombre',pu.nombre) end puestos,
      jsonb_build_object('nombre',pr.nombre,'email',pr.email) profiles,
      lower(coalesce(p.nombre,'')) agente_orden,lower(coalesce(c.nombre,'')) cliente_orden,
      lower(coalesce(u.nombre,'')) unidad_orden,lower(coalesce(pr.nombre,pr.email,'')) coordinador_orden,
      coalesce(d.cantidad_prendas,0) cantidad_prendas,coalesce(d.unidades_totales,0) unidades_totales,
      coalesce(d.total_requerimiento,0) total_requerimiento,coalesce(d.generos,'{}'::text[]) generos
    from public.requerimientos r left join public.personal p on p.id=r.agente_id
    left join public.clientes c on c.id=r.cliente_id left join public.unidades u on u.id=r.unidad_id
    left join public.puestos pu on pu.id=r.puesto_id
    left join public.profiles pr on pr.id=r.usuario_creador_id
    left join lateral (
      select count(*)::integer cantidad_prendas,coalesce(sum(dr.cantidad),0)::integer unidades_totales,
        coalesce(sum(dr.cantidad*dr.precio_unitario),0)::numeric total_requerimiento,
        coalesce(array_agg(distinct g.genero) filter(where g.genero is not null),'{}'::text[]) generos
      from public.detalle_requerimiento dr left join lateral (select a.genero from public.prenda_clientes a where a.prenda_id=dr.prenda_id and a.cliente_id=r.cliente_id and a.puesto_id is not distinct from r.puesto_id and a.renovacion in (r.renovacion,'AMBOS') order by a.activo desc,a.updated_at desc limit 1) g on true
      where dr.requerimiento_id=r.id and dr.activo
    ) d on true
  ), annotated as (
    select a.*,m.grupo_duplicado_id,m.coincidencias+1 grupo_duplicado_tamano,m.coincidencias>0 posible_duplicado,
      m.coincidencias>0 and a.cantidad_prendas<m.max_prendas potencialmente_incompleto
    from all_rows a left join lateral (
      select least(a.id::text,min(b.id::text))::uuid grupo_duplicado_id,count(*)::integer coincidencias,
        greatest(a.cantidad_prendas,max(b.cantidad_prendas))::integer max_prendas
      from all_rows b where b.id<>a.id and b.agente_id=a.agente_id and b.cliente_id is not distinct from a.cliente_id
        and b.unidad_id is not distinct from a.unidad_id and b.usuario_creador_id=a.usuario_creador_id
        and abs(extract(epoch from (b.created_at-a.created_at)))<=86400
        and (b.estado=a.estado or (b.estado in ('Pendiente','Observado') and a.estado in ('Pendiente','Observado')))
    ) m on true
  ), scoped as (
    select * from annotated a where (p_cliente_id is null or a.cliente_id=p_cliente_id)
      and (p_unidad_id is null or a.unidad_id=p_unidad_id) and (p_coordinador_id is null or a.usuario_creador_id=p_coordinador_id)
      and (p_estado is null or a.estado=p_estado) and (p_renovacion is null or a.renovacion=p_renovacion) and (p_puesto_id is null or a.puesto_id=p_puesto_id) and (p_desde is null or a.fecha>=p_desde) and (p_hasta is null or a.fecha<p_hasta)
      and (p_creado_hasta is null or a.created_at<=p_creado_hasta)
      and (p_unidades_min is null or a.unidades_totales>=p_unidades_min) and (p_unidades_max is null or a.unidades_totales<=p_unidades_max)
      and (p_genero is null or (p_genero='HOMBRE' and a.generos&&array['HOMBRE','AMBOS'])
        or (p_genero='MUJER' and a.generos&&array['MUJER','AMBOS']) or (p_genero='AMBOS' and 'AMBOS'=any(a.generos)))
      and (nullif(trim(p_busqueda),'') is null or position(lower(trim(p_busqueda)) in lower(concat_ws(' ',a.personal->>'nombre',a.personal->>'dni',a.clientes->>'nombre',a.unidades->>'nombre',a.puestos->>'nombre',a.profiles->>'nombre',a.profiles->>'email',a.id::text)))>0)
  ), filtered as (select * from scoped where not p_solo_duplicados or posible_duplicado), ranked as (
    select f.*,row_number() over(order by
      case when p_orden='fecha' and p_direccion='asc' then fecha end asc,case when p_orden='fecha' and p_direccion='desc' then fecha end desc,
      case when p_orden='agente' and p_direccion='asc' then agente_orden end asc,case when p_orden='agente' and p_direccion='desc' then agente_orden end desc,
      case when p_orden='cliente' and p_direccion='asc' then cliente_orden end asc,case when p_orden='cliente' and p_direccion='desc' then cliente_orden end desc,
      case when p_orden='unidad' and p_direccion='asc' then unidad_orden end asc,case when p_orden='unidad' and p_direccion='desc' then unidad_orden end desc,
      case when p_orden='coordinador' and p_direccion='asc' then coordinador_orden end asc,case when p_orden='coordinador' and p_direccion='desc' then coordinador_orden end desc,
      case when p_orden='estado' and p_direccion='asc' then estado::text end asc,case when p_orden='estado' and p_direccion='desc' then estado::text end desc,
      case when p_orden='prendas' and p_direccion='asc' then cantidad_prendas end asc,case when p_orden='prendas' and p_direccion='desc' then cantidad_prendas end desc,
      case when p_orden='total' and p_direccion='asc' then total_requerimiento end asc,case when p_orden='total' and p_direccion='desc' then total_requerimiento end desc,id) posicion
    from filtered f where p_cursor_fecha is null or (fecha,id)<(p_cursor_fecha,p_cursor_id)
  ), page as (select * from ranked order by posicion limit p_limite offset p_offset)
  select jsonb_build_object('total',case when p_exportar then null else (select count(*) from filtered) end,
    'duplicate_total',(select count(*) from scoped where posible_duplicado),'duplicate_groups',(select count(distinct grupo_duplicado_id) from scoped where posible_duplicado),
    'rows',coalesce((select jsonb_agg((to_jsonb(r)-'agente_orden'-'cliente_orden'-'unidad_orden'-'coordinador_orden'-'posicion') ||
      case when p_exportar then jsonb_build_object('detalle_requerimiento',coalesce(d.detalles,'[]')) else '{}'::jsonb end order by r.posicion)
      from page r left join lateral (
        select jsonb_agg(jsonb_build_object('id',dr.id,'created_at',dr.created_at,'cantidad',dr.cantidad,
          'precio_unitario',dr.precio_unitario,'codigo_almacen',dr.codigo_almacen,
          'prendas',jsonb_build_object('codigo_prenda',g.codigo_prenda,'nombre_prenda',g.nombre_prenda,'codigo_almacen',g.codigo_almacen)) order by dr.created_at,dr.id) detalles
        from public.detalle_requerimiento dr left join public.prendas g on g.id=dr.prenda_id where dr.requerimiento_id=r.id and dr.activo
      ) d on true),'[]'::jsonb)) into v_result;
  return v_result;
end $function$;

revoke all on function public.admin_consultar_requerimientos_v2(uuid,uuid,uuid,estado_requerimiento,timestamp with time zone,timestamp with time zone,text,text,integer,integer,boolean,text,text,integer,integer,boolean,timestamp with time zone,uuid,timestamp with time zone,text,uuid) from public,anon,authenticated;
grant execute on function public.admin_consultar_requerimientos_v2(uuid,uuid,uuid,estado_requerimiento,timestamp with time zone,timestamp with time zone,text,text,integer,integer,boolean,text,text,integer,integer,boolean,timestamp with time zone,uuid,timestamp with time zone,text,uuid) to authenticated;


CREATE OR REPLACE FUNCTION public.admin_opciones_requerimientos()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Solo administradores' using errcode='42501';
  end if;
  return jsonb_build_object(
    'clientes', (select coalesce(jsonb_agg(to_jsonb(c) order by c.nombre,c.id),'[]') from (select id,nombre from clientes) c),
    'unidades', (select coalesce(jsonb_agg(to_jsonb(u) order by u.nombre,u.id),'[]') from (select id,cliente_id,nombre from unidades) u),
    'puestos', (select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre,x.id),'[]') from (select id,cliente_id,nombre from puestos) x),
    'coordinadores', (select coalesce(jsonb_agg(to_jsonb(p) order by p.nombre,p.id),'[]') from
      (select id,nombre,email from profiles p where exists(select 1 from requerimientos r where r.usuario_creador_id=p.id)) p)
  );
end $function$;

CREATE OR REPLACE FUNCTION public.opciones_requerimientos_propios()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
  select jsonb_build_object(
    'clientes',coalesce((select jsonb_agg(to_jsonb(x) order by x.nombre,x.id) from (
      select distinct c.id,c.nombre from public.requerimientos r join public.clientes c on c.id=r.cliente_id
      where r.usuario_creador_id=auth.uid()) x),'[]'::jsonb),
    'unidades',coalesce((select jsonb_agg(to_jsonb(x) order by x.nombre,x.id) from (
      select distinct u.id,u.cliente_id,u.nombre from public.requerimientos r join public.unidades u on u.id=r.unidad_id
      where r.usuario_creador_id=auth.uid()) x),'[]'::jsonb),
    'puestos',coalesce((select jsonb_agg(to_jsonb(x) order by x.nombre,x.id) from (
      select distinct pu.id,pu.cliente_id,pu.nombre from public.requerimientos r join public.puestos pu on pu.id=r.puesto_id
      where r.usuario_creador_id=auth.uid()) x),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_listar_catalogo(p_catalogo text, p_busqueda text DEFAULT NULL::text, p_cliente_id uuid DEFAULT NULL::uuid, p_genero text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v_rows jsonb; v_total integer; v_q text:=lower(btrim(coalesce(p_busqueda,'')));
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_catalogo not in ('clientes','unidades','personal','prendas','provincias','puestos') or length(v_q)>120
    or p_limite is null or p_limite<1 or p_limite>100 or p_offset is null or p_offset<0 or p_offset>50000
    or (p_genero is not null and p_genero not in ('HOMBRE','MUJER','AMBOS')) then
    raise exception 'Filtros inválidos' using errcode='22023';
  end if;
  case p_catalogo
    when 'clientes' then
      select count(*) into v_total from public.clientes c where v_q='' or position(v_q in lower(c.nombre))>0;
      select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre,x.id),'[]') into v_rows from (
        select c.id,c.nombre,c.activo,c.diferencia_puestos from public.clientes c where v_q='' or position(v_q in lower(c.nombre))>0
        order by c.nombre,c.id limit p_limite offset p_offset) x;
    when 'puestos' then
      select count(*) into v_total from public.puestos pu where (p_cliente_id is null or pu.cliente_id=p_cliente_id)
        and (v_q='' or position(v_q in lower(pu.nombre))>0);
      select coalesce(jsonb_agg((to_jsonb(x)-'cliente_orden') order by x.cliente_orden,x.nombre,x.id),'[]') into v_rows from (
        select pu.id,pu.cliente_id,pu.nombre,pu.activo,jsonb_build_object('nombre',c.nombre) clientes,lower(c.nombre) cliente_orden
        from public.puestos pu join public.clientes c on c.id=pu.cliente_id
        where (p_cliente_id is null or pu.cliente_id=p_cliente_id) and (v_q='' or position(v_q in lower(pu.nombre))>0)
        order by lower(c.nombre),pu.nombre,pu.id limit p_limite offset p_offset) x;
    when 'unidades' then
      select count(*) into v_total from public.unidades u where (p_cliente_id is null or u.cliente_id=p_cliente_id)
        and (v_q='' or position(v_q in lower(u.nombre))>0);
      select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre,x.id),'[]') into v_rows from (
        select u.id,u.cliente_id,u.nombre,u.renovacion_defecto,u.activo,jsonb_build_object('nombre',c.nombre) clientes
        from public.unidades u join public.clientes c on c.id=u.cliente_id
        where (p_cliente_id is null or u.cliente_id=p_cliente_id) and (v_q='' or position(v_q in lower(u.nombre))>0)
        order by u.nombre,u.id limit p_limite offset p_offset) x;
    when 'personal' then
      select count(*) into v_total from public.personal p where v_q='' or
        position(v_q in lower(concat_ws(' ',p.codigo_personal,p.nombre,p.dni,p.cargo)))>0;
      select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre,x.id),'[]') into v_rows from (
        select p.id,p.codigo_personal,p.nombre,p.dni,p.cargo,p.activo from public.personal p where v_q='' or
          position(v_q in lower(concat_ws(' ',p.codigo_personal,p.nombre,p.dni,p.cargo)))>0
        order by p.nombre,p.id limit p_limite offset p_offset) x;
    when 'prendas' then
      select count(*) into v_total from public.prendas p where
        exists(select 1 from public.prenda_clientes a where a.prenda_id=p.id
          and (p_cliente_id is null or a.cliente_id=p_cliente_id) and (p_genero is null or a.genero=p_genero))
        and (v_q='' or position(v_q in lower(concat_ws(' ',p.codigo_prenda,p.nombre_prenda,p.codigo_almacen)))>0);
      select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre_prenda,x.id),'[]') into v_rows from (
        select p.id,p.codigo_prenda,p.nombre_prenda,p.codigo_almacen,p.precio,p.activo,
          coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'cliente_id',a.cliente_id,'cliente',c.nombre,
            'puesto_id',a.puesto_id,'puesto',pu.nombre,'renovacion',a.renovacion,'genero',a.genero,'cantidad',a.cantidad,'activo',a.activo) order by c.nombre,pu.nombre nulls first,a.renovacion)
            from public.prenda_clientes a join public.clientes c on c.id=a.cliente_id
            left join public.puestos pu on pu.id=a.puesto_id where a.prenda_id=p.id),'[]'::jsonb) asignaciones
        from public.prendas p where
          exists(select 1 from public.prenda_clientes a where a.prenda_id=p.id
            and (p_cliente_id is null or a.cliente_id=p_cliente_id) and (p_genero is null or a.genero=p_genero))
          and (v_q='' or position(v_q in lower(concat_ws(' ',p.codigo_prenda,p.nombre_prenda,p.codigo_almacen)))>0)
        order by p.nombre_prenda,p.id limit p_limite offset p_offset) x;
    when 'provincias' then
      select count(*) into v_total from public.provincias p where v_q='' or position(v_q in lower(p.nombre))>0;
      select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre,x.id),'[]') into v_rows from (
        select p.id,p.nombre,p.activo from public.provincias p where v_q='' or position(v_q in lower(p.nombre))>0
        order by p.nombre,p.id limit p_limite offset p_offset) x;
  end case;
  return jsonb_build_object('rows',v_rows,'total',v_total);
end $function$;


CREATE OR REPLACE FUNCTION private.admin_guardar_catalogo(p_catalogo text, p_id uuid, p_valores jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_antes jsonb; v_despues jsonb; v_nombre text; v_codigo text;
  v_usa boolean; v_puesto_id uuid; v_cliente_id uuid; v_cliente_nombre text; v_cliente_activo boolean; v_prenda_id uuid; v_a jsonb; v_alcance text; v_impacto jsonb; v_precio numeric; v_almacen text;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_catalogo not in ('clientes','unidades','personal','prendas','provincias','puestos') or p_valores is null
    or jsonb_typeof(p_valores)<>'object' then raise exception 'Datos inválidos' using errcode='22023'; end if;

  case p_catalogo
    when 'clientes' then
      if (p_valores-'nombre'-'diferencia_puestos')<>'{}'::jsonb
        or (p_valores ? 'diferencia_puestos' and jsonb_typeof(p_valores->'diferencia_puestos')<>'boolean') then
        raise exception 'Campos de cliente inválidos' using errcode='22023'; end if;
      v_usa:=case when p_valores ? 'diferencia_puestos' then (p_valores->>'diferencia_puestos')::boolean end;
      v_nombre:=btrim(p_valores->>'nombre');
      if nullif(v_nombre,'') is null or length(v_nombre)>200 or v_nombre~'[\u0000-\u001f]' then
        raise exception 'El nombre del cliente es obligatorio y admite hasta 200 caracteres' using errcode='22023';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('cliente:'||lower(v_nombre),0));
      if exists(select 1 from public.clientes c where lower(btrim(c.nombre))=lower(v_nombre) and c.id is distinct from p_id) then
        raise exception 'Ya existe un cliente con ese nombre' using errcode='23505';
      end if;
      if p_id is null then
        insert into public.clientes(nombre,activo,diferencia_puestos) values(v_nombre,true,coalesce(v_usa,false)) returning to_jsonb(clientes.*) into v_despues;
      else
        select to_jsonb(c.*) into v_antes from public.clientes c where c.id=p_id for update;
        if v_antes is null then raise exception 'Cliente no encontrado' using errcode='P0002'; end if;
        update public.clientes set nombre=v_nombre,diferencia_puestos=coalesce(v_usa,diferencia_puestos) where id=p_id returning to_jsonb(clientes.*) into v_despues;
      end if;

    when 'puestos' then
      if (p_valores-'nombre'-'cliente_id')<>'{}'::jsonb then raise exception 'Campos de puesto inválidos' using errcode='22023'; end if;
      v_nombre:=btrim(p_valores->>'nombre');
      begin v_cliente_id:=(p_valores->>'cliente_id')::uuid;
      exception when invalid_text_representation then raise exception 'Selecciona un cliente válido' using errcode='22023'; end;
      if nullif(v_nombre,'') is null or length(v_nombre)>200 or v_nombre~'[\u0000-\u001f]' then
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
      if (p_valores-'nombre'-'cliente_id'-'renovacion_defecto')<>'{}'::jsonb then raise exception 'Campos de unidad inválidos' using errcode='22023'; end if;
      if p_valores->>'renovacion_defecto' is null or p_valores->>'renovacion_defecto' not in ('VERANO','INVIERNO') then
        raise exception 'La renovación por defecto debe ser Verano o Invierno' using errcode='22023';
      end if;
      v_nombre:=btrim(p_valores->>'nombre');
      begin v_cliente_id:=(p_valores->>'cliente_id')::uuid;
      exception when invalid_text_representation then raise exception 'Selecciona un cliente válido' using errcode='22023'; end;
      if nullif(v_nombre,'') is null or length(v_nombre)>200 or v_nombre~'[\u0000-\u001f]' then
        raise exception 'El nombre de la unidad es obligatorio y admite hasta 200 caracteres' using errcode='22023';
      end if;
      select c.nombre,c.activo into v_cliente_nombre,v_cliente_activo from public.clientes c where c.id=v_cliente_id for share;
      if not found then raise exception 'Cliente no encontrado' using errcode='P0002'; end if;
      if not v_cliente_activo and (p_id is null or not exists(
        select 1 from public.unidades u where u.id=p_id and u.cliente_id=v_cliente_id
      )) then raise exception 'Reactiva el cliente antes de crear o mover unidades' using errcode='55000'; end if;
      perform pg_advisory_xact_lock(hashtextextended('unidad:'||v_cliente_id::text||':'||lower(v_nombre),0));
      if exists(select 1 from public.unidades u where u.cliente_id=v_cliente_id
        and lower(btrim(u.nombre))=lower(v_nombre) and u.id is distinct from p_id) then
        raise exception 'Ya existe una unidad con ese nombre para el cliente seleccionado' using errcode='23505';
      end if;
      if p_id is null then
        insert into public.unidades(cliente_id,nombre,renovacion_defecto,activo) values(v_cliente_id,v_nombre,p_valores->>'renovacion_defecto',true)
          returning to_jsonb(unidades.*) into v_despues;
      else
        select to_jsonb(u.*) into v_antes from public.unidades u where u.id=p_id for update;
        if v_antes is null then raise exception 'Unidad no encontrada' using errcode='P0002'; end if;
        if (v_antes->>'cliente_id')::uuid<>v_cliente_id
          and exists(select 1 from public.requerimientos r where r.unidad_id=p_id) then
          raise exception 'Una unidad utilizada en requerimientos no puede cambiar de cliente' using errcode='55000';
        end if;
        update public.unidades set cliente_id=v_cliente_id,nombre=v_nombre,renovacion_defecto=p_valores->>'renovacion_defecto' where id=p_id
          returning to_jsonb(unidades.*) into v_despues;
      end if;

    when 'personal' then
      if (p_valores-'codigo_personal'-'nombre'-'dni'-'cargo')<>'{}'::jsonb then
        raise exception 'Campos de personal inválidos' using errcode='22023';
      end if;
      v_codigo:=btrim(p_valores->>'codigo_personal'); v_nombre:=btrim(p_valores->>'nombre');
      if nullif(v_codigo,'') is null or length(v_codigo)>80 or nullif(v_nombre,'') is null or length(v_nombre)>200
        or (p_valores->>'dni')!~'^[0-9]{8}$' or nullif(btrim(p_valores->>'cargo'),'') is null
        or length(btrim(p_valores->>'cargo'))>120 then
        raise exception 'Revisa código, nombre, DNI (exactamente 8 dígitos) y cargo' using errcode='22023';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('personal:'||lower(v_codigo),0));
      if exists(select 1 from public.personal p where lower(btrim(p.codigo_personal))=lower(v_codigo) and p.id is distinct from p_id) then
        raise exception 'Ya existe una persona con ese código' using errcode='23505';
      end if;
      if p_id is null then
        insert into public.personal(codigo_personal,nombre,dni,cargo,activo)
        values(v_codigo,v_nombre,p_valores->>'dni',btrim(p_valores->>'cargo'),true)
        returning to_jsonb(personal.*) into v_despues;
      else
        select to_jsonb(p.*) into v_antes from public.personal p where p.id=p_id for update;
        if v_antes is null then raise exception 'Persona no encontrada' using errcode='P0002'; end if;
        if v_codigo<>v_antes->>'codigo_personal' then raise exception 'El código de personal no puede modificarse' using errcode='55000'; end if;
        update public.personal set nombre=v_nombre,dni=p_valores->>'dni',cargo=btrim(p_valores->>'cargo')
          where id=p_id returning to_jsonb(personal.*) into v_despues;
      end if;

    when 'prendas' then
      if (p_valores-'codigo_prenda'-'nombre_prenda'-'codigo_almacen'-'precio'-'asignaciones'-'alcance')<>'{}'::jsonb then
        raise exception 'Campos de prenda inválidos' using errcode='22023';
      end if;
      v_codigo:=btrim(p_valores->>'codigo_prenda'); v_nombre:=btrim(p_valores->>'nombre_prenda');
      if nullif(v_codigo,'') is null or length(v_codigo)>80 or nullif(v_nombre,'') is null or length(v_nombre)>240
        or nullif(btrim(p_valores->>'codigo_almacen'),'') is null or length(btrim(p_valores->>'codigo_almacen'))>80
        or (p_valores->>'precio')!~'^[0-9]+([.][0-9]{1,2})?$' or (p_valores->>'precio')::numeric>9999999999.99 then
        raise exception 'Revisa código, nombre, almacén y precio' using errcode='22023';
      end if;
      v_alcance:=p_valores->>'alcance';
      if v_alcance is not null and v_alcance not in ('ahora','tramite','todos') then
        raise exception 'Alcance inválido' using errcode='22023'; end if;
      if p_valores ? 'asignaciones' and (jsonb_typeof(p_valores->'asignaciones')<>'array'
        or jsonb_array_length(p_valores->'asignaciones')>200) then
        raise exception 'Las asignaciones son inválidas' using errcode='22023';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('prenda:'||lower(v_codigo),0));
      if exists(select 1 from public.prendas p where lower(btrim(p.codigo_prenda))=lower(v_codigo) and p.id is distinct from p_id) then
        raise exception 'Ya existe una prenda con ese código' using errcode='23505';
      end if;
      v_precio:=(p_valores->>'precio')::numeric; v_almacen:=btrim(p_valores->>'codigo_almacen');
      if p_id is null then
        insert into public.prendas(codigo_prenda,nombre_prenda,codigo_almacen,precio,activo)
        values(v_codigo,v_nombre,v_almacen,v_precio,true) returning id into v_prenda_id;
      else
        select p.id into v_prenda_id from public.prendas p where p.id=p_id for update;
        if v_prenda_id is null then raise exception 'Prenda no encontrada' using errcode='P0002'; end if;
        v_antes:=private.prenda_json(v_prenda_id);
        -- Precio y código de almacén se copian a las líneas: si hay líneas que cambiarían, el alcance es obligatorio.
        v_impacto:=private.impacto_cambio_ficha(v_prenda_id,v_precio,v_almacen);
        if coalesce((v_impacto->'todos'->>'lineas')::integer,0)>0 and v_alcance is null then
          raise exception 'Indica el alcance del cambio de precio o de código de almacén' using errcode='22023'; end if;
        update public.prendas set codigo_prenda=v_codigo where id=v_prenda_id;
        perform private.aplicar_cambio_ficha(v_prenda_id,v_precio,v_almacen,v_nombre,coalesce(v_alcance,'ahora'),'MANTENIMIENTO');
      end if;
      -- Asignaciones (cliente, renovación, género, cantidad, activo). Primero las que se desactivan, para que un
      -- cambio AMBOS <-> VERANO/INVIERNO en un mismo guardado no choque con la regla de convivencia.
      for v_a in select e.value from jsonb_array_elements(coalesce(p_valores->'asignaciones','[]'::jsonb)) e
        order by (e.value->>'activo')='true' loop
        if jsonb_typeof(v_a)<>'object' or (v_a-'id'-'cliente_id'-'puesto_id'-'renovacion'-'genero'-'cantidad'-'activo')<>'{}'::jsonb
          or v_a->>'renovacion' is null or v_a->>'renovacion' not in ('VERANO','INVIERNO','AMBOS')
          or v_a->>'genero' is null or v_a->>'genero' not in ('HOMBRE','MUJER','AMBOS')
          or (v_a->>'cantidad')!~'^[1-9][0-9]{0,4}$' or (v_a->>'cantidad')::integer>10000
          or jsonb_typeof(v_a->'activo')<>'boolean'
          or (v_a ? 'puesto_id' and jsonb_typeof(v_a->'puesto_id') not in ('null','string')) then
          raise exception 'Revisa las asignaciones: cliente, puesto, renovación, género, cantidad y estado' using errcode='22023';
        end if;
        begin v_puesto_id:=nullif(v_a->>'puesto_id','')::uuid;
        exception when invalid_text_representation then raise exception 'Selecciona un puesto válido' using errcode='22023'; end;
        begin
          if v_a->>'id' is not null then
            update public.prenda_clientes set renovacion=v_a->>'renovacion',genero=v_a->>'genero',cantidad=(v_a->>'cantidad')::integer,activo=(v_a->>'activo')::boolean
              where id=(v_a->>'id')::uuid and prenda_id=v_prenda_id
                and (v_a->>'cliente_id' is null or cliente_id=(v_a->>'cliente_id')::uuid)
                and puesto_id is not distinct from v_puesto_id;
            if not found then raise exception 'Asignación no encontrada' using errcode='P0002'; end if;
          else
            begin v_cliente_id:=(v_a->>'cliente_id')::uuid;
            exception when invalid_text_representation then raise exception 'Selecciona un cliente válido' using errcode='22023'; end;
            select c.nombre,c.activo into v_cliente_nombre,v_cliente_activo from public.clientes c where c.id=v_cliente_id for share;
            if not found then raise exception 'Cliente no encontrado' using errcode='P0002'; end if;
            if not v_cliente_activo and (v_a->>'activo')::boolean then raise exception 'Selecciona un cliente activo' using errcode='55000'; end if;
            insert into public.prenda_clientes(prenda_id,cliente_id,puesto_id,renovacion,genero,cantidad,activo)
              values(v_prenda_id,v_cliente_id,v_puesto_id,v_a->>'renovacion',v_a->>'genero',(v_a->>'cantidad')::integer,(v_a->>'activo')::boolean);
          end if;
        exception when unique_violation then
          raise exception 'Esa prenda ya tiene una asignación para el mismo cliente, puesto y renovación' using errcode='23505';
        end;
      end loop;
      v_despues:=private.prenda_json(v_prenda_id);

    when 'provincias' then
      if (p_valores-'nombre')<>'{}'::jsonb then raise exception 'Campos de provincia inválidos' using errcode='22023'; end if;
      v_nombre:=btrim(p_valores->>'nombre');
      if nullif(v_nombre,'') is null or length(v_nombre)>200 or v_nombre~'[\u0000-\u001f]' then
        raise exception 'El nombre de la provincia es obligatorio y admite hasta 200 caracteres' using errcode='22023';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('provincia:'||lower(v_nombre),0));
      if exists(select 1 from public.provincias p where lower(btrim(p.nombre))=lower(v_nombre) and p.id is distinct from p_id) then
        raise exception 'Ya existe una provincia con ese nombre' using errcode='23505';
      end if;
      if p_id is null then
        insert into public.provincias(nombre,activo) values(v_nombre,true) returning to_jsonb(provincias.*) into v_despues;
      else
        select to_jsonb(p.*) into v_antes from public.provincias p where p.id=p_id for update;
        if v_antes is null then raise exception 'Provincia no encontrada' using errcode='P0002'; end if;
        update public.provincias set nombre=v_nombre where id=p_id returning to_jsonb(provincias.*) into v_despues;
      end if;
  end case;

  insert into private.admin_catalog_audit(usuario_id,accion,catalogo,registro_id,valores_antes,valores_despues)
  values(auth.uid(),case when p_id is null then 'CREAR' else 'EDITAR' end,p_catalogo,
    (v_despues->>'id')::uuid,v_antes,v_despues);
  return jsonb_build_object('accion',case when p_id is null then 'crear' else 'editar' end,'row',v_despues);
end $function$;

CREATE OR REPLACE FUNCTION private.admin_actualizar_catalogo_activo(p_catalogo text, p_id uuid, p_activo boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v_antes jsonb; v_despues jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_catalogo not in ('clientes','unidades','personal','prendas','provincias','puestos') or p_id is null or p_activo is null then
    raise exception 'Datos inválidos' using errcode='22023';
  end if;
  case p_catalogo
    when 'clientes' then select to_jsonb(c.*) into v_antes from public.clientes c where c.id=p_id for update;
    when 'unidades' then select to_jsonb(u.*) into v_antes from public.unidades u where u.id=p_id for update;
    when 'personal' then select to_jsonb(p.*) into v_antes from public.personal p where p.id=p_id for update;
    when 'prendas' then select to_jsonb(p.*) into v_antes from public.prendas p where p.id=p_id for update;
    when 'provincias' then select to_jsonb(p.*) into v_antes from public.provincias p where p.id=p_id for update;
    when 'puestos' then select to_jsonb(pu.*) into v_antes from public.puestos pu where pu.id=p_id for update;
  end case;
  if v_antes is null then raise exception 'Registro no encontrado' using errcode='P0002'; end if;
  if p_catalogo='unidades' and p_activo and not exists(
    select 1 from public.clientes c where c.id=(v_antes->>'cliente_id')::uuid and c.activo
  ) then raise exception 'Reactiva el cliente antes de activar esta unidad' using errcode='55000'; end if;
  case p_catalogo
    when 'clientes' then update public.clientes set activo=p_activo where id=p_id returning to_jsonb(clientes.*) into v_despues;
    when 'unidades' then update public.unidades set activo=p_activo where id=p_id returning to_jsonb(unidades.*) into v_despues;
    when 'personal' then update public.personal set activo=p_activo where id=p_id returning to_jsonb(personal.*) into v_despues;
    when 'prendas' then update public.prendas set activo=p_activo where id=p_id returning to_jsonb(prendas.*) into v_despues;
    when 'provincias' then update public.provincias set activo=p_activo where id=p_id returning to_jsonb(provincias.*) into v_despues;
    when 'puestos' then update public.puestos set activo=p_activo where id=p_id returning to_jsonb(puestos.*) into v_despues;
  end case;
  insert into private.admin_catalog_audit(usuario_id,accion,catalogo,registro_id,valores_antes,valores_despues)
  values(auth.uid(),case when p_activo then 'ACTIVAR' else 'DESACTIVAR' end,p_catalogo,p_id,v_antes,v_despues);
  return v_despues;
end $function$;

CREATE OR REPLACE FUNCTION private.admin_eliminar_catalogo(p_catalogo text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  declare v_antes jsonb;
  begin
    if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
    if p_catalogo not in ('clientes','unidades') or p_id is null then
      raise exception 'El catálogo no admite eliminación definitiva' using errcode='22023';
    end if;
    if p_catalogo='clientes' then
      select to_jsonb(c.*) into v_antes from public.clientes c where c.id=p_id for update;
      if v_antes is null then raise exception 'Cliente no encontrado' using errcode='P0002'; end if;
      if exists(select 1 from public.unidades u where u.cliente_id=p_id)
        or exists(select 1 from public.puestos pu where pu.cliente_id=p_id)
        or exists(select 1 from public.prenda_clientes a where a.cliente_id=p_id)
        or exists(select 1 from public.requerimientos r where r.cliente_id=p_id) then
        raise exception 'El cliente tiene información asociada; solo puedes desactivarlo' using errcode='55000';
      end if;
      delete from public.clientes where id=p_id;
    else
      select to_jsonb(u.*) into v_antes from public.unidades u where u.id=p_id for update;
      if v_antes is null then raise exception 'Unidad no encontrada' using errcode='P0002'; end if;
      if exists(select 1 from public.requerimientos r where r.unidad_id=p_id) then
        raise exception 'La unidad tiene requerimientos asociados; solo puedes desactivarla' using errcode='55000';
      end if;
      delete from public.unidades where id=p_id;
    end if;
    insert into private.admin_catalog_audit(usuario_id,accion,catalogo,registro_id,valores_antes,valores_despues)
    values(auth.uid(),'ELIMINAR',p_catalogo,p_id,v_antes,null);
    return jsonb_build_object('id',p_id,'catalogo',p_catalogo);
  end $function$;

CREATE OR REPLACE FUNCTION public.admin_capacidades_catalogo(p_catalogo text, p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  declare v_result jsonb;
  begin
    if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
    if p_catalogo not in ('clientes','unidades') or p_ids is null or cardinality(p_ids)>100 then
      raise exception 'Datos inválidos' using errcode='22023';
    end if;
    if p_catalogo='clientes' then
      select coalesce(jsonb_object_agg(c.id::text,
        not exists(select 1 from public.unidades u where u.cliente_id=c.id)
        and not exists(select 1 from public.puestos pu where pu.cliente_id=c.id)
        and not exists(select 1 from public.prenda_clientes a where a.cliente_id=c.id)
        and not exists(select 1 from public.requerimientos r where r.cliente_id=c.id)),'{}')
      into v_result from public.clientes c where c.id=any(p_ids);
    else
      select coalesce(jsonb_object_agg(u.id::text,
        not exists(select 1 from public.requerimientos r where r.unidad_id=u.id)),'{}')
      into v_result from public.unidades u where u.id=any(p_ids);
    end if;
    return v_result;
  end $function$;

drop function private.prendas_import_filas(jsonb);

CREATE OR REPLACE FUNCTION private.prendas_import_filas(p_filas jsonb)
 RETURNS TABLE(fila integer, codigo_prenda text, nombre_prenda text, codigo_almacen text, precio numeric, cantidad integer, genero text, renovacion text, activo boolean, puesto text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v jsonb;
begin
  if p_filas is null or jsonb_typeof(p_filas)<>'array' or jsonb_array_length(p_filas)<1 or jsonb_array_length(p_filas)>1000
    or octet_length(p_filas::text)>1048576 then raise exception 'Importación inválida' using errcode='22023'; end if;
  for v in select e.value from jsonb_array_elements(p_filas) e loop
    if jsonb_typeof(v)<>'object'
      or (v-'fila'-'codigo_prenda'-'nombre_prenda'-'codigo_almacen'-'precio'-'cantidad'-'genero'-'renovacion'-'activo'-'puesto')<>'{}'::jsonb
      or (v->>'fila')!~'^[1-9][0-9]{0,6}$'
      or nullif(btrim(v->>'codigo_prenda'),'') is null or length(btrim(v->>'codigo_prenda'))>80
      or nullif(btrim(v->>'nombre_prenda'),'') is null or length(btrim(v->>'nombre_prenda'))>240
      or nullif(btrim(v->>'codigo_almacen'),'') is null or length(btrim(v->>'codigo_almacen'))>80
      or (v->>'precio')!~'^[0-9]+([.][0-9]{1,2})?$' or (v->>'precio')::numeric>9999999999.99
      or (v->>'cantidad')!~'^[1-9][0-9]{0,4}$' or (v->>'cantidad')::integer>10000
      or v->>'genero' not in ('HOMBRE','MUJER','AMBOS')
      or v->>'renovacion' not in ('VERANO','INVIERNO','AMBOS')
      or jsonb_typeof(v->'activo')<>'boolean'
      or (v ? 'puesto' and (jsonb_typeof(v->'puesto') not in ('null','string') or length(btrim(coalesce(v->>'puesto','')))>200)) then
      raise exception 'Fila de prenda inválida (fila %)',coalesce(v->>'fila','?') using errcode='22023';
    end if;
    fila:=(v->>'fila')::integer; codigo_prenda:=btrim(v->>'codigo_prenda'); nombre_prenda:=btrim(v->>'nombre_prenda');
    codigo_almacen:=btrim(v->>'codigo_almacen'); precio:=(v->>'precio')::numeric; cantidad:=(v->>'cantidad')::integer;
    genero:=v->>'genero'; renovacion:=v->>'renovacion'; activo:=(v->'activo')::boolean;
    puesto:=nullif(btrim(coalesce(v->>'puesto','')),'');
    return next;
  end loop;
end $function$;

revoke all on function private.prendas_import_filas(jsonb) from public,anon,authenticated;
grant execute on function private.prendas_import_filas(jsonb) to authenticated;


CREATE OR REPLACE FUNCTION private.admin_importar_prendas(p_cliente_id uuid, p_filas jsonb, p_aplicar boolean, p_actualizar jsonb DEFAULT '{}'::jsonb, p_reemplazar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_cliente text; v_usa boolean; v_f jsonb; v_alertas jsonb; v_desactivar jsonb; v_inactivas jsonb; v_renov jsonb; v_cambios jsonb:='[]'::jsonb;
  v_antes jsonb; v_prendas_nuevas integer; v_nuevas integer; v_cantidad integer; v_genero integer; v_estado integer; v_igual integer;
  v_k text; v_v text; v_r record; v_res jsonb; v_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_cliente_id is null or p_aplicar is null or p_reemplazar is null or p_actualizar is null
    or jsonb_typeof(p_actualizar)<>'object' then raise exception 'Datos inválidos' using errcode='22023'; end if;
  for v_k,v_v in select e.key,e.value#>>'{}' from jsonb_each(p_actualizar) e loop
    if length(v_k)>80 or v_v is null or v_v not in ('ahora','tramite','todos') then
      raise exception 'Alcance inválido para %',left(v_k,80) using errcode='22023'; end if;
    if v_v='todos' and not public.is_superadmin() then
      raise exception 'Solo un superadmin puede aplicar el cambio a todos los requerimientos' using errcode='42501'; end if;
  end loop;
  select c.nombre,c.diferencia_puestos into v_cliente,v_usa from public.clientes c where c.id=p_cliente_id and c.activo for share;
  if not found then raise exception 'Selecciona un cliente activo' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('importar_prendas:'||p_cliente_id::text,0));

  select jsonb_agg(to_jsonb(x)) into v_f from private.prendas_import_filas(p_filas) x;
  drop table if exists pg_temp.imp_f; drop table if exists pg_temp.imp_repl; drop table if exists pg_temp.imp_sitio;
  create temp table imp_f on commit drop as
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
  -- Defensa: la pantalla ya marca estos errores por fila; aquí nunca se acepta algo ambiguo.
  if exists(select 1 from pg_temp.imp_f group by codigo_prenda,renovacion,puesto_id having count(*)>1) then
    raise exception 'El archivo repite un código con la misma renovación' using errcode='22023'; end if;
  if exists(select 1 from pg_temp.imp_f a join pg_temp.imp_f b on a.codigo_prenda=b.codigo_prenda
    and a.puesto_id is not distinct from b.puesto_id and a.renovacion='AMBOS' and b.renovacion<>'AMBOS') then
    raise exception 'El archivo combina AMBOS con VERANO o INVIERNO para un mismo código' using errcode='22023'; end if;
  if exists(select 1 from pg_temp.imp_f group by codigo_prenda
    having count(distinct (nombre_prenda,codigo_almacen,precio))>1) then
    raise exception 'El archivo trae datos distintos de ficha para un mismo código' using errcode='22023'; end if;

  -- Asignaciones VIGENTES del cliente que chocan con las renovaciones que trae el archivo para ese código
  -- (AMBOS contra VERANO/INVIERNO): el archivo manda y las reemplaza. Con una sola fila en el archivo y una sola
  -- asignación vigente en conflicto, se cambia su renovación en el lugar (AMBOS -> VERANO o al revés).
  create temp table imp_repl on commit drop as
    select a.id as asignacion_id,a.puesto_id,p.codigo_prenda,p.nombre_prenda,a.renovacion as de,
      (select string_agg(distinct f.renovacion,' y ' order by f.renovacion) from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.puesto_id is not distinct from a.puesto_id) as a_renovacion
    from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id
    where a.cliente_id=p_cliente_id and a.activo
      and exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.puesto_id is not distinct from a.puesto_id and f.renovacion<>a.renovacion
        and (a.renovacion='AMBOS' or f.renovacion='AMBOS'))
      and not exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.puesto_id is not distinct from a.puesto_id and f.renovacion=a.renovacion);
  create temp table imp_sitio on commit drop as
    select r.asignacion_id,f.fila,f.renovacion as nueva
    from pg_temp.imp_repl r join pg_temp.imp_f f on f.codigo_prenda=r.codigo_prenda and f.puesto_id is not distinct from r.puesto_id
    where (select count(*) from pg_temp.imp_f x where x.codigo_prenda=r.codigo_prenda and x.puesto_id is not distinct from r.puesto_id)=1
      and (select count(*) from pg_temp.imp_repl y where y.codigo_prenda=r.codigo_prenda and y.puesto_id is not distinct from r.puesto_id)=1
      and not exists(select 1 from public.prenda_clientes e join public.prendas pe on pe.id=e.prenda_id
        where e.cliente_id=p_cliente_id and e.puesto_id is not distinct from r.puesto_id and pe.codigo_prenda=r.codigo_prenda and e.renovacion=f.renovacion);
  select coalesce(jsonb_agg(jsonb_build_object('codigo',r.codigo_prenda,'nombre',r.nombre_prenda,'de',r.de,'a',r.a_renovacion)
    order by r.codigo_prenda),'[]'::jsonb) into v_renov from pg_temp.imp_repl r;

  select count(distinct o.codigo_prenda) into v_prendas_nuevas from pg_temp.imp_f o
    where not exists(select 1 from public.prendas p where p.codigo_prenda=o.codigo_prenda);
  -- Cada fila del archivo se empareja con su asignación vigente: la de la misma renovación o la que cambia de renovación.
  select count(*) filter(where m.aid is null),
         count(*) filter(where m.aid is not null and e.cantidad<>m.cantidad),
         count(*) filter(where m.aid is not null and e.genero<>m.genero),
         count(*) filter(where m.aid is not null and e.activo<>m.activo),
         count(*) filter(where m.aid is not null and not m.en_sitio and e.cantidad=m.cantidad and e.genero=m.genero and e.activo=m.activo)
    into v_nuevas,v_cantidad,v_genero,v_estado,v_igual
    from (select o.fila,o.cantidad,o.genero,o.activo,coalesce(a.id,s.asignacion_id) as aid,(a.id is null and s.asignacion_id is not null) as en_sitio
      from pg_temp.imp_f o left join public.prendas p on p.codigo_prenda=o.codigo_prenda
      left join public.prenda_clientes a on a.prenda_id=p.id and a.cliente_id=p_cliente_id and a.puesto_id is not distinct from o.puesto_id and a.renovacion=o.renovacion
      left join pg_temp.imp_sitio s on s.fila=o.fila) m
    left join public.prenda_clientes e on e.id=m.aid;

  select coalesce(jsonb_agg(jsonb_build_object('codigo',t.codigo_prenda,'nombre',t.nombre_prenda,'cambios',t.cambios,'impacto',t.impacto)
    order by t.codigo_prenda),'[]'::jsonb) into v_alertas
  from (select o.codigo_prenda,p.nombre_prenda,(select jsonb_agg(c.j) from (
      select jsonb_build_object('campo','precio','actual',p.precio::text,'archivo',o.precio::numeric(12,2)::text) j where p.precio<>o.precio
      union all select jsonb_build_object('campo','nombre_prenda','actual',p.nombre_prenda,'archivo',o.nombre_prenda) where p.nombre_prenda<>o.nombre_prenda
      union all select jsonb_build_object('campo','codigo_almacen','actual',p.codigo_almacen,'archivo',o.codigo_almacen) where p.codigo_almacen<>o.codigo_almacen) c) cambios,
      private.impacto_cambio_ficha(p.id,o.precio,o.codigo_almacen) impacto
    from (select distinct on (codigo_prenda) * from pg_temp.imp_f order by codigo_prenda,fila) o
    join public.prendas p on p.codigo_prenda=o.codigo_prenda) t where t.cambios is not null;

  select coalesce(jsonb_agg(distinct o.codigo_prenda),'[]'::jsonb) into v_inactivas from pg_temp.imp_f o
    join public.prendas p on p.codigo_prenda=o.codigo_prenda where not p.activo;

  select coalesce(jsonb_agg(jsonb_build_object('codigo',p.codigo_prenda,'nombre',p.nombre_prenda,'renovacion',a.renovacion,
    'cantidad',a.cantidad,'puesto',(select pu.nombre from public.puestos pu where pu.id=a.puesto_id)) order by p.codigo_prenda,a.renovacion),'[]'::jsonb) into v_desactivar
  from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id
  where p_reemplazar and a.cliente_id=p_cliente_id and a.activo
    and not exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.puesto_id is not distinct from a.puesto_id and f.renovacion=a.renovacion)
    and not exists(select 1 from pg_temp.imp_sitio s where s.asignacion_id=a.id);

  if p_aplicar then
    select coalesce(jsonb_agg(jsonb_build_object('codigo',p.codigo_prenda,'puesto_id',a.puesto_id,'renovacion',a.renovacion,'genero',a.genero,'cantidad',a.cantidad,'activo',a.activo)
      order by p.codigo_prenda,a.renovacion),'[]'::jsonb) into v_antes
    from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id
    where a.cliente_id=p_cliente_id and (p_reemplazar or exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda));

    insert into public.prendas(codigo_prenda,nombre_prenda,codigo_almacen,precio,activo)
      select distinct on (o.codigo_prenda) o.codigo_prenda,o.nombre_prenda,o.codigo_almacen,o.precio,true
      from pg_temp.imp_f o where not exists(select 1 from public.prendas p where p.codigo_prenda=o.codigo_prenda)
      order by o.codigo_prenda,o.fila;
    -- Fichas existentes: solo las elegidas, con su alcance (precio/código de almacén se copian a las líneas).
    for v_r in select o.codigo_prenda,o.nombre_prenda,o.codigo_almacen,o.precio,p.id,e.value#>>'{}' as alcance
      from (select distinct on (codigo_prenda) * from pg_temp.imp_f order by codigo_prenda,fila) o
      join public.prendas p on p.codigo_prenda=o.codigo_prenda
      join jsonb_each(p_actualizar) e on e.key=o.codigo_prenda loop
      v_res:=private.aplicar_cambio_ficha(v_r.id,v_r.precio,v_r.codigo_almacen,v_r.nombre_prenda,v_r.alcance,'IMPORTAR');
      v_cambios:=v_cambios||jsonb_build_array(jsonb_build_object('codigo',v_r.codigo_prenda,'alcance',v_r.alcance,
        'requerimientos',v_res->'requerimientos','lineas',v_res->'lineas'));
    end loop;
    -- Orden: cambios de renovación en el lugar y desactivaciones primero; luego altas y activaciones.
    update public.prenda_clientes a set renovacion=s.nueva,cantidad=o.cantidad,genero=o.genero,activo=o.activo
      from pg_temp.imp_sitio s join pg_temp.imp_f o on o.fila=s.fila where a.id=s.asignacion_id;
    update public.prenda_clientes a set activo=false from pg_temp.imp_repl r
      where a.id=r.asignacion_id and not exists(select 1 from pg_temp.imp_sitio s where s.asignacion_id=r.asignacion_id);
    update public.prenda_clientes a set activo=false from pg_temp.imp_f o, public.prendas p
      where p.codigo_prenda=o.codigo_prenda and a.prenda_id=p.id and a.cliente_id=p_cliente_id
        and a.puesto_id is not distinct from o.puesto_id and a.renovacion=o.renovacion and not o.activo and a.activo;
    update public.prenda_clientes a set activo=false from public.prendas p
      where p_reemplazar and p.id=a.prenda_id and a.cliente_id=p_cliente_id and a.activo
        and not exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.puesto_id is not distinct from a.puesto_id and f.renovacion=a.renovacion)
        and not exists(select 1 from pg_temp.imp_sitio s where s.asignacion_id=a.id);
    insert into public.prenda_clientes(prenda_id,cliente_id,puesto_id,renovacion,genero,cantidad,activo)
      select p.id,p_cliente_id,o.puesto_id,o.renovacion,o.genero,o.cantidad,false from pg_temp.imp_f o
      join public.prendas p on p.codigo_prenda=o.codigo_prenda where not o.activo
      on conflict (prenda_id,cliente_id,puesto_id,renovacion) do update set cantidad=excluded.cantidad,genero=excluded.genero;
    insert into public.prenda_clientes(prenda_id,cliente_id,puesto_id,renovacion,genero,cantidad,activo)
      select p.id,p_cliente_id,o.puesto_id,o.renovacion,o.genero,o.cantidad,true from pg_temp.imp_f o
      join public.prendas p on p.codigo_prenda=o.codigo_prenda where o.activo
      on conflict (prenda_id,cliente_id,puesto_id,renovacion) do update set cantidad=excluded.cantidad,genero=excluded.genero,activo=true;

    insert into private.admin_catalog_audit(usuario_id,accion,catalogo,registro_id,valores_antes,valores_despues)
    values(auth.uid(),'IMPORTAR','prendas',p_cliente_id,v_antes,jsonb_build_object('cliente',v_cliente,'reemplazar',p_reemplazar,
      'actualizar_fichas',p_actualizar,'cambios_ficha',v_cambios,'prendas_nuevas',v_prendas_nuevas,'asignaciones_nuevas',v_nuevas,
      'cantidades_actualizadas',v_cantidad,'generos_actualizados',v_genero,'renovaciones_actualizadas',v_renov,
      'estados_actualizados',v_estado,'desactivadas',jsonb_array_length(v_desactivar),
      'filas',(select coalesce(jsonb_agg(jsonb_build_object('codigo',o.codigo_prenda,'puesto',o.puesto,'renovacion',o.renovacion,'genero',o.genero,'cantidad',o.cantidad,'activo',o.activo)
        order by o.fila),'[]'::jsonb) from pg_temp.imp_f o)));
  end if;

  return jsonb_build_object('aplicado',p_aplicar,'cliente',v_cliente,'prendas_nuevas',v_prendas_nuevas,
    'asignaciones_nuevas',v_nuevas,'cantidades_actualizadas',v_cantidad,'generos_actualizados',v_genero,
    'estados_actualizados',v_estado,'sin_cambios',v_igual,'renovaciones_actualizadas',v_renov,
    'alertas',v_alertas,'desactivar',v_desactivar,'fichas_inactivas',v_inactivas,'cambios_ficha',v_cambios);
end $function$;


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
