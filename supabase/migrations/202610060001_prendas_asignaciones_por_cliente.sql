-- Prendas: ficha única + asignaciones por cliente y renovación.
-- Aplicar después de 202610020001. UNA sola ejecución (todo en una transacción).
--
-- Problema: cada prenda tenía un solo cliente y la importación hacía upsert por codigo_prenda, así que
-- importar INDECOPI movía a INDECOPI las prendas que ya eran de RENIEC.
--
-- Nuevo modelo
--  * public.prendas = ficha (una vez): codigo_prenda único, nombre, código de almacén, género, precio.
--  * public.prenda_clientes = asignación prenda-cliente-renovación (VERANO/INVIERNO/AMBOS) con su cantidad.
--    - única por (prenda, cliente, renovación): una prenda puede tener VERANO 6 e INVIERNO 3 para un cliente;
--    - AMBOS no puede convivir (activo) con VERANO/INVIERNO para la misma prenda y cliente (trigger con
--      bloqueo asesor: también protege de inserciones concurrentes).
--  * Se migran los datos actuales: cada prenda genera su asignación con su cliente, renovación y cantidad.
--    Los ids de prendas no cambian, así que las líneas de requerimientos ya registrados (que además guardan
--    cantidad, precio y código como snapshot) siguen mostrando lo mismo.
--  * Los valores anteriores (cliente, cantidad, renovación) se conservan en private.prendas_asignacion_respaldo
--    antes de quitar esas columnas de public.prendas.
--  * crear_requerimiento / editar_prendas_requerimiento solo aceptan prendas asignadas al cliente del
--    requerimiento y a su renovación (o AMBOS), y usan la cantidad de esa asignación.
--  * Importación por cliente: public.admin_importar_prendas (vista previa y aplicar). Nunca toca asignaciones
--    de otro cliente; no cambia fichas existentes salvo que se pida explícitamente.
begin;

-- 1. Respaldo (no expuesto) de lo que había en la ficha.
create table private.prendas_asignacion_respaldo as
  select p.id as prenda_id,p.codigo_prenda,p.cliente,p.cantidad,p.renovacion,p.activo,now() as respaldado_at
  from public.prendas p;
revoke all on private.prendas_asignacion_respaldo from public,anon,authenticated;

-- 2. Asignaciones.
create table public.prenda_clientes(
  id uuid primary key default gen_random_uuid(),
  prenda_id uuid not null references public.prendas(id) on delete restrict,
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  renovacion text not null check (renovacion in ('VERANO','INVIERNO','AMBOS')),
  cantidad integer not null check (cantidad between 1 and 10000),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prenda_clientes_unica unique (prenda_id,cliente_id,renovacion)
);
create index prenda_clientes_cliente_renovacion_idx on public.prenda_clientes(cliente_id,renovacion) where activo;
comment on table public.prenda_clientes is 'Asignación de una prenda (ficha) a un cliente por renovación, con la cantidad que le corresponde.';

create function private.prenda_clientes_validar() returns trigger language plpgsql
set search_path=pg_catalog,public,pg_temp as $$
begin
  if tg_op='UPDATE' and (new.prenda_id<>old.prenda_id or new.cliente_id<>old.cliente_id) then
    raise exception 'Una asignación no puede cambiar de prenda ni de cliente' using errcode='55000';
  end if;
  new.updated_at:=now();
  if new.activo then
    -- Serializa altas concurrentes de la misma prenda y cliente.
    perform pg_advisory_xact_lock(pg_catalog.hashtextextended('prenda_cliente:'||new.prenda_id::text||':'||new.cliente_id::text,0));
    if exists(select 1 from public.prenda_clientes o
      where o.prenda_id=new.prenda_id and o.cliente_id=new.cliente_id and o.id is distinct from new.id
        and o.activo and o.renovacion<>new.renovacion and (o.renovacion='AMBOS' or new.renovacion='AMBOS')) then
      raise exception 'AMBOS no puede convivir con VERANO o INVIERNO para la misma prenda y cliente' using errcode='23P01';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.prenda_clientes_validar() from public,anon,authenticated;
create trigger prenda_clientes_validar before insert or update on public.prenda_clientes
  for each row execute function private.prenda_clientes_validar();

alter table public.prenda_clientes enable row level security;
revoke all on public.prenda_clientes from public,anon,authenticated;
grant select on public.prenda_clientes to authenticated;
grant select,insert,update,delete on public.prenda_clientes to service_role;
create policy "asignaciones autenticado" on public.prenda_clientes for select to authenticated
  using (activo or public.is_admin());

-- 3. Migrar los datos actuales: una asignación por prenda con su cliente, renovación y cantidad.
insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,cantidad,activo)
  select p.id,c.id,p.renovacion,p.cantidad,p.activo
  from public.prendas p join public.clientes c on lower(btrim(c.nombre))=lower(btrim(p.cliente));
do $migracion$
declare v_prendas integer; v_asignaciones integer;
begin
  select count(*) into v_prendas from public.prendas;
  select count(*) into v_asignaciones from public.prenda_clientes;
  if v_asignaciones<>v_prendas then
    raise warning 'Prendas sin cliente reconocido (sin asignación): %. Sus valores anteriores quedan en private.prendas_asignacion_respaldo.',v_prendas-v_asignaciones;
  end if;
  raise notice 'Prendas: %, asignaciones creadas: %',v_prendas,v_asignaciones;
end $migracion$;

-- 4. La ficha ya no lleva cliente, cantidad ni renovación (se borran también sus índices y restricciones).
alter table public.prendas drop column cliente, drop column cantidad, drop column renovacion;
create index prendas_codigo_activo_idx on public.prendas(genero,nombre_prenda,id) where activo;

alter table private.admin_catalog_audit drop constraint if exists admin_catalog_audit_accion_check;
alter table private.admin_catalog_audit add constraint admin_catalog_audit_accion_check
  check (accion in ('CREAR','EDITAR','ACTIVAR','DESACTIVAR','ELIMINAR','IMPORTAR'));

-- Ficha + asignaciones como json (auditoría y respuesta de Mantenimiento).
create function private.prenda_json(p_id uuid) returns jsonb language sql stable
set search_path=pg_catalog,public,pg_temp as $$
  select to_jsonb(p.*) || jsonb_build_object('asignaciones',coalesce((
    select jsonb_agg(jsonb_build_object('id',a.id,'cliente_id',a.cliente_id,'cliente',c.nombre,'renovacion',a.renovacion,
      'cantidad',a.cantidad,'activo',a.activo) order by c.nombre,a.renovacion)
    from public.prenda_clientes a join public.clientes c on c.id=a.cliente_id where a.prenda_id=p.id),'[]'::jsonb))
  from public.prendas p where p.id=p_id;
$$;
revoke all on function private.prenda_json(uuid) from public,anon,authenticated;
grant execute on function private.prenda_json(uuid) to authenticated;

create or replace function public.crear_requerimiento(
  p_agente_id uuid,p_cliente_id uuid,p_unidad_id uuid,p_renovacion text,p_detalles jsonb,p_request_id uuid
) returns uuid language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  v_id uuid;
  v_cliente text;
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
  -- Serializa únicamente reintentos de la misma solicitud del mismo usuario.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text || ':' || p_request_id::text,0));
  select r.id into v_id from public.requerimientos r
    where r.usuario_creador_id=auth.uid() and r.request_id=p_request_id;
  if found then return v_id; end if;
  perform id from public.personal where id=p_agente_id and activo for share;
  if not found then raise exception 'Agente inválido o inactivo'; end if;
  select nombre into v_cliente from public.clientes where id=p_cliente_id and activo for share;
  if not found then raise exception 'Selecciona un cliente activo'; end if;
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
      and a.renovacion in (p_renovacion,'AMBOS')
    order by a.id for share of a,p;
  get diagnostics v_count=row_count;
  if v_count<>cardinality(v_prendas) then
    raise exception 'La prenda no corresponde al cliente ni a la renovación seleccionados, o está inactiva' using errcode='22023';
  end if;
  insert into public.requerimientos(agente_id,usuario_creador_id,cliente_id,unidad_id,renovacion,referencia_interna,request_id)
    values(p_agente_id,auth.uid(),p_cliente_id,p_unidad_id,p_renovacion,'RENOVACION '||p_renovacion,p_request_id) returning id into v_id;
  insert into public.detalle_requerimiento(requerimiento_id,prenda_id,cantidad,precio_unitario,codigo_almacen)
    select v_id,p.id,a.cantidad,p.precio,p.codigo_almacen from public.prendas p
    join public.prenda_clientes a on a.prenda_id=p.id and a.cliente_id=p_cliente_id and a.activo
      and a.renovacion in (p_renovacion,'AMBOS')
    where p.id=any(v_prendas);
  return v_id;
end;
$$;

create or replace function public.obtener_edicion_prendas(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_row public.requerimientos; v_details jsonb; v_header jsonb;
begin
  select r.* into v_row from public.requerimientos r
    join public.profiles p on p.id=auth.uid()
    where r.id=p_id and (p.role in ('admin','superadmin') or (p.role='coordinador' and r.usuario_creador_id=p.id));
  if not found then raise exception 'No autorizado' using errcode='42501'; end if;
  -- 'prendas' trae la cantidad y renovación de la asignación vigente (si ya no existe, la de la línea).
  select coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object('prendas',to_jsonb(g) ||
      jsonb_build_object('cantidad',coalesce(a.cantidad,d.cantidad),'renovacion',coalesce(a.renovacion,v_row.renovacion)))
      order by d.created_at,d.id),'[]') into v_details
    from public.detalle_requerimiento d join public.prendas g on g.id=d.prenda_id
    left join public.prenda_clientes a on a.prenda_id=g.id and a.cliente_id=v_row.cliente_id and a.activo
      and a.renovacion in (v_row.renovacion,'AMBOS')
    where d.requerimiento_id=p_id and d.activo;
  select to_jsonb(r) || jsonb_build_object(
      'personal',jsonb_build_object('nombre',p.nombre,'dni',p.dni,'cargo',p.cargo),
      'clientes',case when c.id is not null then jsonb_build_object('nombre',c.nombre) end,
      'unidades',case when u.id is not null then jsonb_build_object('nombre',u.nombre) end,
      'detalle_requerimiento',v_details) into v_header
    from public.requerimientos r join public.personal p on p.id=r.agente_id
    left join public.clientes c on c.id=r.cliente_id
    left join public.unidades u on u.id=r.unidad_id where r.id=p_id;
  return jsonb_build_object('requerimiento',v_header,'version',md5(v_details::text));
end $$;

create or replace function public.editar_prendas_requerimiento(p_id uuid,p_version text,p_detalles jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
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
        and a.renovacion in (v_row.renovacion,'AMBOS'))) then
    raise exception 'La prenda no corresponde al cliente ni a la renovación del requerimiento, o está inactiva' using errcode='22023';
  end if;
  -- Retirar primero permite sustituir una línea por otra de la misma prenda.
  update public.detalle_requerimiento d
    set activo=false,retirado_at=clock_timestamp(),retirado_por=auth.uid()
    where d.requerimiento_id=p_id and d.activo and not exists(
      select 1 from jsonb_to_recordset(p_detalles) as x(prenda_id uuid,detalle_id uuid) where x.detalle_id=d.id);
  -- Solo cantidad proviene del maestro; precio/código de líneas conservadas no cambian.
  update public.detalle_requerimiento d set cantidad=a.cantidad from public.prenda_clientes a
    where d.requerimiento_id=p_id and d.activo and a.prenda_id=d.prenda_id and a.cliente_id=v_row.cliente_id
      and a.activo and a.renovacion in (v_row.renovacion,'AMBOS');
  insert into public.detalle_requerimiento(requerimiento_id,prenda_id,cantidad,precio_unitario,codigo_almacen)
    select p_id,g.id,a.cantidad,g.precio,g.codigo_almacen
    from jsonb_to_recordset(p_detalles) as x(prenda_id uuid,detalle_id uuid)
    join public.prendas g on g.id=x.prenda_id
    join public.prenda_clientes a on a.prenda_id=g.id and a.cliente_id=v_row.cliente_id and a.activo
      and a.renovacion in (v_row.renovacion,'AMBOS')
    where x.detalle_id is null;
  return public.obtener_edicion_prendas(p_id);
end $$;

create or replace function private.admin_guardar_catalogo(p_catalogo text,p_id uuid,p_valores jsonb)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_antes jsonb; v_despues jsonb; v_nombre text; v_codigo text;
  v_cliente_id uuid; v_cliente_nombre text; v_cliente_activo boolean; v_prenda_id uuid; v_a jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_catalogo not in ('clientes','unidades','personal','prendas','provincias') or p_valores is null
    or jsonb_typeof(p_valores)<>'object' then raise exception 'Datos inválidos' using errcode='22023'; end if;

  case p_catalogo
    when 'clientes' then
      if (p_valores-'nombre')<>'{}'::jsonb then raise exception 'Campos de cliente inválidos' using errcode='22023'; end if;
      v_nombre:=btrim(p_valores->>'nombre');
      if nullif(v_nombre,'') is null or length(v_nombre)>200 or v_nombre~'[\u0000-\u001f]' then
        raise exception 'El nombre del cliente es obligatorio y admite hasta 200 caracteres' using errcode='22023';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('cliente:'||lower(v_nombre),0));
      if exists(select 1 from public.clientes c where lower(btrim(c.nombre))=lower(v_nombre) and c.id is distinct from p_id) then
        raise exception 'Ya existe un cliente con ese nombre' using errcode='23505';
      end if;
      if p_id is null then
        insert into public.clientes(nombre,activo) values(v_nombre,true) returning to_jsonb(clientes.*) into v_despues;
      else
        select to_jsonb(c.*) into v_antes from public.clientes c where c.id=p_id for update;
        if v_antes is null then raise exception 'Cliente no encontrado' using errcode='P0002'; end if;
        update public.clientes set nombre=v_nombre where id=p_id returning to_jsonb(clientes.*) into v_despues;
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
        or (p_valores->>'dni')!~'^[0-9]{8,12}$' or nullif(btrim(p_valores->>'cargo'),'') is null
        or length(btrim(p_valores->>'cargo'))>120 then
        raise exception 'Revisa código, nombre, DNI y cargo' using errcode='22023';
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
      if (p_valores-'codigo_prenda'-'nombre_prenda'-'codigo_almacen'-'precio'-'genero'-'asignaciones')<>'{}'::jsonb then
        raise exception 'Campos de prenda inválidos' using errcode='22023';
      end if;
      v_codigo:=btrim(p_valores->>'codigo_prenda'); v_nombre:=btrim(p_valores->>'nombre_prenda');
      if nullif(v_codigo,'') is null or length(v_codigo)>80 or nullif(v_nombre,'') is null or length(v_nombre)>240
        or nullif(btrim(p_valores->>'codigo_almacen'),'') is null or length(btrim(p_valores->>'codigo_almacen'))>80
        or (p_valores->>'precio')!~'^[0-9]+([.][0-9]{1,2})?$' or (p_valores->>'precio')::numeric>9999999999.99
        or p_valores->>'genero' not in ('HOMBRE','MUJER','AMBOS') then
        raise exception 'Revisa código, nombre, almacén, precio y género' using errcode='22023';
      end if;
      if p_valores ? 'asignaciones' and (jsonb_typeof(p_valores->'asignaciones')<>'array'
        or jsonb_array_length(p_valores->'asignaciones')>200) then
        raise exception 'Las asignaciones son inválidas' using errcode='22023';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('prenda:'||lower(v_codigo),0));
      if exists(select 1 from public.prendas p where lower(btrim(p.codigo_prenda))=lower(v_codigo) and p.id is distinct from p_id) then
        raise exception 'Ya existe una prenda con ese código' using errcode='23505';
      end if;
      if p_id is null then
        insert into public.prendas(codigo_prenda,nombre_prenda,codigo_almacen,precio,genero,activo)
        values(v_codigo,v_nombre,btrim(p_valores->>'codigo_almacen'),(p_valores->>'precio')::numeric,p_valores->>'genero',true)
        returning id into v_prenda_id;
      else
        select p.id into v_prenda_id from public.prendas p where p.id=p_id for update;
        if v_prenda_id is null then raise exception 'Prenda no encontrada' using errcode='P0002'; end if;
        v_antes:=private.prenda_json(v_prenda_id);
        update public.prendas set codigo_prenda=v_codigo,nombre_prenda=v_nombre,
          codigo_almacen=btrim(p_valores->>'codigo_almacen'),precio=(p_valores->>'precio')::numeric,genero=p_valores->>'genero'
        where id=v_prenda_id;
      end if;
      -- Asignaciones (cliente, renovación, cantidad, activo). Primero las que se desactivan, para que un
      -- cambio AMBOS <-> VERANO/INVIERNO en un mismo guardado no choque con la regla de convivencia.
      for v_a in select e.value from jsonb_array_elements(coalesce(p_valores->'asignaciones','[]'::jsonb)) e
        order by (e.value->>'activo')='true' loop
        if jsonb_typeof(v_a)<>'object' or (v_a-'id'-'cliente_id'-'renovacion'-'cantidad'-'activo')<>'{}'::jsonb
          or v_a->>'renovacion' is null or v_a->>'renovacion' not in ('VERANO','INVIERNO','AMBOS')
          or (v_a->>'cantidad')!~'^[1-9][0-9]{0,4}$' or (v_a->>'cantidad')::integer>10000
          or jsonb_typeof(v_a->'activo')<>'boolean' then
          raise exception 'Revisa las asignaciones: cliente, renovación, cantidad y estado' using errcode='22023';
        end if;
        begin
          if v_a->>'id' is not null then
            update public.prenda_clientes set renovacion=v_a->>'renovacion',cantidad=(v_a->>'cantidad')::integer,activo=(v_a->>'activo')::boolean
              where id=(v_a->>'id')::uuid and prenda_id=v_prenda_id
                and (v_a->>'cliente_id' is null or cliente_id=(v_a->>'cliente_id')::uuid);
            if not found then raise exception 'Asignación no encontrada' using errcode='P0002'; end if;
          else
            begin v_cliente_id:=(v_a->>'cliente_id')::uuid;
            exception when invalid_text_representation then raise exception 'Selecciona un cliente válido' using errcode='22023'; end;
            select c.nombre,c.activo into v_cliente_nombre,v_cliente_activo from public.clientes c where c.id=v_cliente_id for share;
            if not found then raise exception 'Cliente no encontrado' using errcode='P0002'; end if;
            if not v_cliente_activo and (v_a->>'activo')::boolean then raise exception 'Selecciona un cliente activo' using errcode='55000'; end if;
            insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,cantidad,activo)
              values(v_prenda_id,v_cliente_id,v_a->>'renovacion',(v_a->>'cantidad')::integer,(v_a->>'activo')::boolean);
          end if;
        exception when unique_violation then
          raise exception 'Esa prenda ya tiene una asignación para el mismo cliente y renovación' using errcode='23505';
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
end $$;
revoke all on function private.admin_guardar_catalogo(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.admin_guardar_catalogo(text,uuid,jsonb) to authenticated;

create or replace function public.admin_listar_catalogo(
  p_catalogo text,p_busqueda text default null,p_cliente_id uuid default null,
  p_genero text default null,p_limite integer default 50,p_offset integer default 0
) returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog,public,pg_temp as $$
declare v_rows jsonb; v_total integer; v_q text:=lower(btrim(coalesce(p_busqueda,'')));
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_catalogo not in ('clientes','unidades','personal','prendas','provincias') or length(v_q)>120
    or p_limite is null or p_limite<1 or p_limite>100 or p_offset is null or p_offset<0 or p_offset>50000
    or (p_genero is not null and p_genero not in ('HOMBRE','MUJER','AMBOS')) then
    raise exception 'Filtros inválidos' using errcode='22023';
  end if;
  case p_catalogo
    when 'clientes' then
      select count(*) into v_total from public.clientes c where v_q='' or position(v_q in lower(c.nombre))>0;
      select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre,x.id),'[]') into v_rows from (
        select c.id,c.nombre,c.activo from public.clientes c where v_q='' or position(v_q in lower(c.nombre))>0
        order by c.nombre,c.id limit p_limite offset p_offset) x;
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
        (p_cliente_id is null or exists(select 1 from public.prenda_clientes a where a.prenda_id=p.id and a.cliente_id=p_cliente_id))
        and (p_genero is null or p.genero=p_genero) and (v_q='' or
          position(v_q in lower(concat_ws(' ',p.codigo_prenda,p.nombre_prenda,p.codigo_almacen)))>0);
      select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre_prenda,x.id),'[]') into v_rows from (
        select p.id,p.codigo_prenda,p.nombre_prenda,p.codigo_almacen,p.precio,p.genero,p.activo,
          coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'cliente_id',a.cliente_id,'cliente',c.nombre,
            'renovacion',a.renovacion,'cantidad',a.cantidad,'activo',a.activo) order by c.nombre,a.renovacion)
            from public.prenda_clientes a join public.clientes c on c.id=a.cliente_id where a.prenda_id=p.id),'[]'::jsonb) asignaciones
        from public.prendas p where
          (p_cliente_id is null or exists(select 1 from public.prenda_clientes a where a.prenda_id=p.id and a.cliente_id=p_cliente_id))
          and (p_genero is null or p.genero=p_genero) and (v_q='' or
            position(v_q in lower(concat_ws(' ',p.codigo_prenda,p.nombre_prenda,p.codigo_almacen)))>0)
        order by p.nombre_prenda,p.id limit p_limite offset p_offset) x;
    when 'provincias' then
      select count(*) into v_total from public.provincias p where v_q='' or position(v_q in lower(p.nombre))>0;
      select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre,x.id),'[]') into v_rows from (
        select p.id,p.nombre,p.activo from public.provincias p where v_q='' or position(v_q in lower(p.nombre))>0
        order by p.nombre,p.id limit p_limite offset p_offset) x;
  end case;
  return jsonb_build_object('rows',v_rows,'total',v_total);
end $$;
revoke all on function public.admin_listar_catalogo(text,text,uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.admin_listar_catalogo(text,text,uuid,text,integer,integer) to authenticated;

create or replace function private.admin_importar_catalogo(p_catalogo text,p_filas jsonb)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v jsonb; v_new integer:=0; v_updated integer:=0; v_exists boolean;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_catalogo<>'personal' or p_filas is null or jsonb_typeof(p_filas)<>'array'
    or jsonb_array_length(p_filas)<1 or jsonb_array_length(p_filas)>1000 or octet_length(p_filas::text)>1048576 then
    raise exception 'Importación inválida' using errcode='22023';
  end if;
  for v in select value from jsonb_array_elements(p_filas) loop
    if p_catalogo='personal' then
      if jsonb_typeof(v)<>'object' or (v-'codigo_personal'-'nombre'-'dni'-'cargo'-'activo')<>'{}'::jsonb
        or nullif(btrim(v->>'codigo_personal'),'') is null or length(btrim(v->>'codigo_personal'))>80
        or nullif(btrim(v->>'nombre'),'') is null or length(btrim(v->>'nombre'))>200
        or (v->>'dni')!~'^[0-9]{8,12}$' or nullif(btrim(v->>'cargo'),'') is null or length(btrim(v->>'cargo'))>120
        or jsonb_typeof(v->'activo')<>'boolean' then raise exception 'Fila de personal inválida' using errcode='22023'; end if;
      select exists(select 1 from public.personal where codigo_personal=btrim(v->>'codigo_personal')) into v_exists;
      insert into public.personal(codigo_personal,nombre,dni,cargo,activo)
      values(btrim(v->>'codigo_personal'),btrim(v->>'nombre'),v->>'dni',btrim(v->>'cargo'),(v->>'activo')::boolean)
      on conflict(codigo_personal) do update set nombre=excluded.nombre,dni=excluded.dni,cargo=excluded.cargo,activo=excluded.activo;
    end if;
    if v_exists then v_updated:=v_updated+1; else v_new:=v_new+1; end if;
  end loop;
  return jsonb_build_object('nuevos',v_new,'actualizados',v_updated,'omitidos',0,'errores',0);
end $$;
revoke all on function private.admin_importar_catalogo(text,jsonb) from public,anon,authenticated;
grant execute on function private.admin_importar_catalogo(text,jsonb) to authenticated;

create or replace function private.admin_eliminar_catalogo(p_catalogo text,p_id uuid)
  returns jsonb language plpgsql volatile security definer
  set search_path=pg_catalog,public,pg_temp as $$
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
  end $$;

create or replace function public.admin_capacidades_catalogo(p_catalogo text,p_ids uuid[])
  returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public,pg_temp as $$
  declare v_result jsonb;
  begin
    if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
    if p_catalogo not in ('clientes','unidades') or p_ids is null or cardinality(p_ids)>100 then
      raise exception 'Datos inválidos' using errcode='22023';
    end if;
    if p_catalogo='clientes' then
      select coalesce(jsonb_object_agg(c.id::text,
        not exists(select 1 from public.unidades u where u.cliente_id=c.id)
        and not exists(select 1 from public.prenda_clientes a where a.cliente_id=c.id)
        and not exists(select 1 from public.requerimientos r where r.cliente_id=c.id)),'{}')
      into v_result from public.clientes c where c.id=any(p_ids);
    else
      select coalesce(jsonb_object_agg(u.id::text,
        not exists(select 1 from public.requerimientos r where r.unidad_id=u.id)),'{}')
      into v_result from public.unidades u where u.id=any(p_ids);
    end if;
    return v_result;
  end $$;


-- Prendas que el formulario ofrece: asignadas (activas) al cliente, de la renovación elegida o AMBOS, con la
-- cantidad de esa asignación. El género se filtra en la pantalla.
create function public.listar_prendas_cliente(p_cliente_id uuid,p_renovacion text)
returns table(id uuid,codigo_prenda text,nombre_prenda text,codigo_almacen text,precio numeric,genero text,
  cantidad integer,renovacion text,activo boolean)
language plpgsql stable security invoker set search_path=pg_catalog,public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_cliente_id is null or p_renovacion is null or p_renovacion not in ('VERANO','INVIERNO') then
    raise exception 'Cliente o renovación inválidos' using errcode='22023';
  end if;
  return query
    select p.id,p.codigo_prenda,p.nombre_prenda,p.codigo_almacen,p.precio,p.genero,a.cantidad,a.renovacion,p.activo
    from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id
    where a.cliente_id=p_cliente_id and a.activo and p.activo and a.renovacion in (p_renovacion,'AMBOS')
    order by p.nombre_prenda,p.id;
end $$;
revoke all on function public.listar_prendas_cliente(uuid,text) from public,anon,authenticated;
grant execute on function public.listar_prendas_cliente(uuid,text) to authenticated;


-- Normaliza y valida las filas del archivo (la pantalla ya limpió espacios y tipos; aquí se vuelve a exigir).
create function private.prendas_import_filas(p_filas jsonb)
returns table(fila integer,codigo_prenda text,nombre_prenda text,codigo_almacen text,precio numeric,cantidad integer,
  genero text,renovacion text,activo boolean)
language plpgsql stable set search_path=pg_catalog,public,pg_temp as $$
declare v jsonb;
begin
  if p_filas is null or jsonb_typeof(p_filas)<>'array' or jsonb_array_length(p_filas)<1 or jsonb_array_length(p_filas)>1000
    or octet_length(p_filas::text)>1048576 then raise exception 'Importación inválida' using errcode='22023'; end if;
  for v in select e.value from jsonb_array_elements(p_filas) e loop
    if jsonb_typeof(v)<>'object'
      or (v-'fila'-'codigo_prenda'-'nombre_prenda'-'codigo_almacen'-'precio'-'cantidad'-'genero'-'renovacion'-'activo')<>'{}'::jsonb
      or (v->>'fila')!~'^[1-9][0-9]{0,6}$'
      or nullif(btrim(v->>'codigo_prenda'),'') is null or length(btrim(v->>'codigo_prenda'))>80
      or nullif(btrim(v->>'nombre_prenda'),'') is null or length(btrim(v->>'nombre_prenda'))>240
      or nullif(btrim(v->>'codigo_almacen'),'') is null or length(btrim(v->>'codigo_almacen'))>80
      or (v->>'precio')!~'^[0-9]+([.][0-9]{1,2})?$' or (v->>'precio')::numeric>9999999999.99
      or (v->>'cantidad')!~'^[1-9][0-9]{0,4}$' or (v->>'cantidad')::integer>10000
      or v->>'genero' not in ('HOMBRE','MUJER','AMBOS')
      or v->>'renovacion' not in ('VERANO','INVIERNO','AMBOS')
      or jsonb_typeof(v->'activo')<>'boolean' then
      raise exception 'Fila de prenda inválida (fila %)',coalesce(v->>'fila','?') using errcode='22023';
    end if;
    fila:=(v->>'fila')::integer; codigo_prenda:=btrim(v->>'codigo_prenda'); nombre_prenda:=btrim(v->>'nombre_prenda');
    codigo_almacen:=btrim(v->>'codigo_almacen'); precio:=(v->>'precio')::numeric; cantidad:=(v->>'cantidad')::integer;
    genero:=v->>'genero'; renovacion:=v->>'renovacion'; activo:=(v->'activo')::boolean;
    return next;
  end loop;
end $$;
revoke all on function private.prendas_import_filas(jsonb) from public,anon,authenticated;
grant execute on function private.prendas_import_filas(jsonb) to authenticated;

-- Vista previa (p_aplicar=false) o aplicación de la importación de UN cliente.
--  * Solo crea/modifica asignaciones de p_cliente_id; nunca las de otro cliente.
--  * Si el código ya existe se reutiliza la ficha; sus datos (precio, nombre, almacén, género) solo se
--    modifican para los códigos listados en p_actualizar.
--  * p_reemplazar desactiva (no borra) las asignaciones activas del cliente que no vienen en el archivo.
create function private.admin_importar_prendas(p_cliente_id uuid,p_filas jsonb,p_aplicar boolean,
  p_actualizar text[] default '{}',p_reemplazar boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  v_cliente text; v_f jsonb; v_conf jsonb; v_alertas jsonb; v_desactivar jsonb; v_inactivas jsonb;
  v_antes jsonb; v_prendas_nuevas integer; v_nuevas integer; v_cantidad integer; v_estado integer; v_igual integer;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_cliente_id is null or p_aplicar is null or p_reemplazar is null or p_actualizar is null
    or cardinality(p_actualizar)>1000 then raise exception 'Datos inválidos' using errcode='22023'; end if;
  select c.nombre into v_cliente from public.clientes c where c.id=p_cliente_id and c.activo for share;
  if not found then raise exception 'Selecciona un cliente activo' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('importar_prendas:'||p_cliente_id::text,0));

  select jsonb_agg(to_jsonb(x)) into v_f from private.prendas_import_filas(p_filas) x;
  drop table if exists pg_temp.imp_f; drop table if exists pg_temp.imp_conf; drop table if exists pg_temp.imp_ok;
  create temp table imp_f on commit drop as
    select * from jsonb_to_recordset(v_f) as f(fila integer,codigo_prenda text,nombre_prenda text,codigo_almacen text,
      precio numeric,cantidad integer,genero text,renovacion text,activo boolean);
  -- Defensa: la pantalla ya marca estos errores por fila; aquí nunca se acepta algo ambiguo.
  if exists(select 1 from pg_temp.imp_f group by codigo_prenda,renovacion having count(*)>1) then
    raise exception 'El archivo repite un código con la misma renovación' using errcode='22023'; end if;
  if exists(select 1 from pg_temp.imp_f a join pg_temp.imp_f b on a.codigo_prenda=b.codigo_prenda
    and a.renovacion='AMBOS' and b.renovacion<>'AMBOS') then
    raise exception 'El archivo combina AMBOS con VERANO o INVIERNO para un mismo código' using errcode='22023'; end if;
  if exists(select 1 from pg_temp.imp_f group by codigo_prenda
    having count(distinct (nombre_prenda,codigo_almacen,precio,genero))>1) then
    raise exception 'El archivo trae datos distintos de ficha para un mismo código' using errcode='22023'; end if;

  -- Conflictos con lo ya asignado al cliente (resultado final: archivo + asignaciones que se conservan).
  create temp table imp_conf on commit drop as
    with ex as (select p.codigo_prenda,a.renovacion,a.activo from public.prenda_clientes a
        join public.prendas p on p.id=a.prenda_id where a.cliente_id=p_cliente_id),
    fin as (
      select f.fila,f.codigo_prenda,f.renovacion,f.activo from pg_temp.imp_f f
      union all
      select null::integer,e.codigo_prenda,e.renovacion,case when p_reemplazar then false else e.activo end from ex e
        where not exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=e.codigo_prenda and f.renovacion=e.renovacion))
    select x.fila,x.codigo_prenda,x.renovacion,array_agg(distinct y.renovacion order by y.renovacion) as otras from fin x
      join fin y on y.codigo_prenda=x.codigo_prenda and y.renovacion<>x.renovacion
        and (x.renovacion='AMBOS' or y.renovacion='AMBOS')
      where x.fila is not null and x.activo and y.activo
      group by x.fila,x.codigo_prenda,x.renovacion;
  select coalesce(jsonb_agg(jsonb_build_object('fila',c.fila,'codigo',c.codigo_prenda,'renovacion',c.renovacion,'otras',to_jsonb(c.otras))
    order by c.fila),'[]'::jsonb) into v_conf from pg_temp.imp_conf c;
  create temp table imp_ok on commit drop as
    select f.* from pg_temp.imp_f f where not exists(select 1 from pg_temp.imp_conf c where c.fila=f.fila);

  select count(distinct o.codigo_prenda) into v_prendas_nuevas from pg_temp.imp_ok o
    where not exists(select 1 from public.prendas p where p.codigo_prenda=o.codigo_prenda);
  select count(*) filter(where a.id is null),
         count(*) filter(where a.id is not null and a.cantidad<>o.cantidad),
         count(*) filter(where a.id is not null and a.cantidad=o.cantidad and a.activo<>o.activo),
         count(*) filter(where a.id is not null and a.cantidad=o.cantidad and a.activo=o.activo)
    into v_nuevas,v_cantidad,v_estado,v_igual
    from pg_temp.imp_ok o left join public.prendas p on p.codigo_prenda=o.codigo_prenda
    left join public.prenda_clientes a on a.prenda_id=p.id and a.cliente_id=p_cliente_id and a.renovacion=o.renovacion;

  select coalesce(jsonb_agg(jsonb_build_object('codigo',t.codigo_prenda,'nombre',t.nombre_prenda,'cambios',t.cambios)
    order by t.codigo_prenda),'[]'::jsonb) into v_alertas
  from (select o.codigo_prenda,p.nombre_prenda,(select jsonb_agg(c.j) from (
      select jsonb_build_object('campo','precio','actual',p.precio::text,'archivo',o.precio::numeric(12,2)::text) j where p.precio<>o.precio
      union all select jsonb_build_object('campo','nombre_prenda','actual',p.nombre_prenda,'archivo',o.nombre_prenda) where p.nombre_prenda<>o.nombre_prenda
      union all select jsonb_build_object('campo','codigo_almacen','actual',p.codigo_almacen,'archivo',o.codigo_almacen) where p.codigo_almacen<>o.codigo_almacen
      union all select jsonb_build_object('campo','genero','actual',p.genero,'archivo',o.genero) where p.genero<>o.genero) c) cambios
    from (select distinct on (codigo_prenda) * from pg_temp.imp_ok order by codigo_prenda,fila) o
    join public.prendas p on p.codigo_prenda=o.codigo_prenda) t where t.cambios is not null;

  select coalesce(jsonb_agg(distinct o.codigo_prenda),'[]'::jsonb) into v_inactivas from pg_temp.imp_ok o
    join public.prendas p on p.codigo_prenda=o.codigo_prenda where not p.activo;

  select coalesce(jsonb_agg(jsonb_build_object('codigo',p.codigo_prenda,'nombre',p.nombre_prenda,'renovacion',a.renovacion,
    'cantidad',a.cantidad) order by p.codigo_prenda,a.renovacion),'[]'::jsonb) into v_desactivar
  from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id
  where p_reemplazar and a.cliente_id=p_cliente_id and a.activo
    and not exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.renovacion=a.renovacion);

  if p_aplicar then
    if p_reemplazar and jsonb_array_length(v_conf)>0 then
      raise exception 'No se puede reemplazar el catálogo mientras haya conflictos de renovación' using errcode='22023'; end if;
    -- Estado anterior de lo que se va a tocar (para auditoría y recuperación).
    select coalesce(jsonb_agg(jsonb_build_object('codigo',p.codigo_prenda,'renovacion',a.renovacion,'cantidad',a.cantidad,'activo',a.activo)
      order by p.codigo_prenda,a.renovacion),'[]'::jsonb) into v_antes
    from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id
    where a.cliente_id=p_cliente_id and (p_reemplazar or exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda));

    insert into public.prendas(codigo_prenda,nombre_prenda,codigo_almacen,precio,genero,activo)
      select distinct on (o.codigo_prenda) o.codigo_prenda,o.nombre_prenda,o.codigo_almacen,o.precio,o.genero,true
      from pg_temp.imp_ok o where not exists(select 1 from public.prendas p where p.codigo_prenda=o.codigo_prenda)
      order by o.codigo_prenda,o.fila;
    update public.prendas p set nombre_prenda=o.nombre_prenda,codigo_almacen=o.codigo_almacen,precio=o.precio,genero=o.genero
      from (select distinct on (codigo_prenda) * from pg_temp.imp_ok order by codigo_prenda,fila) o
      where p.codigo_prenda=o.codigo_prenda and p.codigo_prenda=any(p_actualizar);
    -- Orden: primero lo que se desactiva, luego lo que se activa (regla de convivencia AMBOS vs VERANO/INVIERNO).
    update public.prenda_clientes a set activo=false from pg_temp.imp_ok o, public.prendas p
      where p.codigo_prenda=o.codigo_prenda and a.prenda_id=p.id and a.cliente_id=p_cliente_id
        and a.renovacion=o.renovacion and not o.activo and a.activo;
    update public.prenda_clientes a set activo=false from public.prendas p
      where p_reemplazar and p.id=a.prenda_id and a.cliente_id=p_cliente_id and a.activo
        and not exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.renovacion=a.renovacion);
    insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,cantidad,activo)
      select p.id,p_cliente_id,o.renovacion,o.cantidad,false from pg_temp.imp_ok o
      join public.prendas p on p.codigo_prenda=o.codigo_prenda where not o.activo
      on conflict (prenda_id,cliente_id,renovacion) do update set cantidad=excluded.cantidad;
    insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,cantidad,activo)
      select p.id,p_cliente_id,o.renovacion,o.cantidad,true from pg_temp.imp_ok o
      join public.prendas p on p.codigo_prenda=o.codigo_prenda where o.activo
      on conflict (prenda_id,cliente_id,renovacion) do update set cantidad=excluded.cantidad,activo=true;

    insert into private.admin_catalog_audit(usuario_id,accion,catalogo,registro_id,valores_antes,valores_despues)
    values(auth.uid(),'IMPORTAR','prendas',p_cliente_id,v_antes,jsonb_build_object('cliente',v_cliente,'reemplazar',p_reemplazar,
      'actualizar_fichas',to_jsonb(p_actualizar),'prendas_nuevas',v_prendas_nuevas,'asignaciones_nuevas',v_nuevas,
      'cantidades_actualizadas',v_cantidad,'estados_actualizados',v_estado,'desactivadas',jsonb_array_length(v_desactivar),
      'filas',(select coalesce(jsonb_agg(jsonb_build_object('codigo',o.codigo_prenda,'renovacion',o.renovacion,'cantidad',o.cantidad,'activo',o.activo)
        order by o.fila),'[]'::jsonb) from pg_temp.imp_ok o)));
  end if;

  return jsonb_build_object('aplicado',p_aplicar,'cliente',v_cliente,'prendas_nuevas',v_prendas_nuevas,
    'asignaciones_nuevas',v_nuevas,'cantidades_actualizadas',v_cantidad,'estados_actualizados',v_estado,'sin_cambios',v_igual,
    'alertas',v_alertas,'conflictos',v_conf,'desactivar',v_desactivar,'fichas_inactivas',v_inactivas);
end $$;
revoke all on function private.admin_importar_prendas(uuid,jsonb,boolean,text[],boolean) from public,anon,authenticated;
grant execute on function private.admin_importar_prendas(uuid,jsonb,boolean,text[],boolean) to authenticated;
create function public.admin_importar_prendas(p_cliente_id uuid,p_filas jsonb,p_aplicar boolean default false,
  p_actualizar text[] default '{}',p_reemplazar boolean default false) returns jsonb
language sql volatile security invoker set search_path=pg_catalog,pg_temp as $$
  select private.admin_importar_prendas(p_cliente_id,p_filas,p_aplicar,p_actualizar,p_reemplazar);
$$;
revoke all on function public.admin_importar_prendas(uuid,jsonb,boolean,text[],boolean) from public,anon,authenticated;
grant execute on function public.admin_importar_prendas(uuid,jsonb,boolean,text[],boolean) to authenticated;

notify pgrst,'reload schema';
commit;
