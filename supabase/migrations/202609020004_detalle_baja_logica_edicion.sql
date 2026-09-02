-- Ejecutar después de 202609020003_rol_coordinador.sql. No elimina registros.
begin;
alter table public.detalle_requerimiento
  add column activo boolean not null default true,
  add column retirado_at timestamptz,
  add column retirado_por uuid references public.profiles(id),
  add constraint detalle_retiro_consistente check (
    (activo and retirado_at is null and retirado_por is null) or
    (not activo and retirado_at is not null and retirado_por is not null)
  );
-- Sustituye la restricción, NO los datos: varias versiones históricas y una activa.
alter table public.detalle_requerimiento
  drop constraint detalle_requerimiento_requerimiento_id_prenda_id_key;
create unique index detalle_prenda_activa_unique
  on public.detalle_requerimiento(requerimiento_id,prenda_id) where activo;
comment on column public.detalle_requerimiento.activo is
  'Baja lógica. Las líneas retiradas conservan cantidad, precio y código históricos; nunca se reactivan.';

-- Se combina con la política de propietario/admin existente, sin reemplazarla.
-- También protege consultas anteriores, agregados y RPC administrativas INVOKER.
create policy detalle_operativo_activo on public.detalle_requerimiento
  as restrictive for select to authenticated using (activo);
revoke insert,update,delete,truncate on public.detalle_requerimiento from public,anon,authenticated;

create function public.proteger_historial_detalle()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then
    raise exception 'Las prendas se retiran mediante baja lógica; no se permite borrar el historial';
  end if;
  if not old.activo then
    raise exception 'Las líneas retiradas son inmutables';
  end if;
  if new.id is distinct from old.id or new.requerimiento_id is distinct from old.requerimiento_id
    or new.prenda_id is distinct from old.prenda_id or new.created_at is distinct from old.created_at
    or new.precio_unitario is distinct from old.precio_unitario
    or new.codigo_almacen is distinct from old.codigo_almacen
    or (not new.activo and new.cantidad is distinct from old.cantidad) then
    raise exception 'No se permite alterar los valores históricos de la línea';
  end if;
  return new;
end $$;
create trigger proteger_historial_detalle before update or delete on public.detalle_requerimiento
  for each row execute function public.proteger_historial_detalle();

-- Misma frontera que crear_requerimiento: única transacción elevada, sin acceso
-- anónimo ni DML directo. No acepta cabecera, cantidades ni precios del navegador.
create function public.obtener_edicion_prendas(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_row public.requerimientos; v_details jsonb; v_header jsonb;
begin
  select r.* into v_row from public.requerimientos r
    join public.profiles p on p.id=auth.uid()
    where r.id=p_id and (p.role='admin' or (p.role='coordinador' and r.usuario_creador_id=p.id));
  if not found then raise exception 'No autorizado' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object('prendas',to_jsonb(g))
      order by d.created_at,d.id),'[]') into v_details
    from public.detalle_requerimiento d join public.prendas g on g.id=d.prenda_id
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
revoke all on function public.obtener_edicion_prendas(uuid) from public,anon;
grant execute on function public.obtener_edicion_prendas(uuid) to authenticated;

create function public.editar_prendas_requerimiento(p_id uuid,p_version text,p_detalles jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.requerimientos; v_payload jsonb; v_cliente text; v_count integer; v_ids uuid[];
begin
  -- Bloqueo de cabecera serializa edición con cualquier cambio de estado.
  select r.* into v_row from public.requerimientos r
    join public.profiles p on p.id=auth.uid()
    where r.id=p_id and (p.role='admin' or (p.role='coordinador' and r.usuario_creador_id=p.id))
    for update of r;
  if not found then raise exception 'No autorizado' using errcode='42501'; end if;
  if v_row.estado='Atendido' then
    raise exception 'Este requerimiento ya fue atendido y no puede modificarse.' using errcode='55000';
  end if;
  if p_detalles is null or jsonb_typeof(p_detalles)<>'array' then
    raise exception 'Incluye al menos una prenda' using errcode='22023';
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
    where x.detalle_id is null and not exists(select 1 from public.prendas g
      where g.id=x.prenda_id and g.activo and g.cliente=v_cliente)) then
    raise exception 'La prenda no corresponde al cliente o está inactiva' using errcode='22023';
  end if;
  -- Retirar primero permite sustituir una línea por otra de la misma prenda.
  update public.detalle_requerimiento d
    set activo=false,retirado_at=clock_timestamp(),retirado_por=auth.uid()
    where d.requerimiento_id=p_id and d.activo and not exists(
      select 1 from jsonb_to_recordset(p_detalles) as x(prenda_id uuid,detalle_id uuid) where x.detalle_id=d.id);
  -- Solo cantidad proviene del maestro; precio/código de líneas conservadas no cambian.
  update public.detalle_requerimiento d set cantidad=g.cantidad from public.prendas g
    where d.requerimiento_id=p_id and d.activo and g.id=d.prenda_id;
  insert into public.detalle_requerimiento(requerimiento_id,prenda_id,cantidad,precio_unitario,codigo_almacen)
    select p_id,g.id,g.cantidad,g.precio,g.codigo_almacen
    from jsonb_to_recordset(p_detalles) as x(prenda_id uuid,detalle_id uuid)
    join public.prendas g on g.id=x.prenda_id where x.detalle_id is null;
  return public.obtener_edicion_prendas(p_id);
end $$;
revoke all on function public.editar_prendas_requerimiento(uuid,text,jsonb) from public,anon;
grant execute on function public.editar_prendas_requerimiento(uuid,text,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
