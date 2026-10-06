-- Género por asignación (cliente) y cambio de precio/código de almacén con alcance elegible.
-- Aplicar después de 202610060001. UNA sola ejecución (todo en una transacción).
--
-- 1. El género va en la asignación prenda-cliente (la corbata 11UNTCPLC073 es HOMBRE para RENIEC y AMBOS para
--    INDECOPI): prenda_clientes.genero se llena con el género actual de la ficha y prendas.genero se elimina
--    (su valor anterior queda en private.prendas_genero_respaldo). El formulario, crear_requerimiento
--    (nuevo p_genero) y editar_prendas_requerimiento (p_genero opcional) validan el género de la ASIGNACIÓN.
-- 2. Las líneas de requerimiento COPIAN cantidad, precio_unitario y codigo_almacen al crearse; el NOMBRE no se
--    copia (se lee en vivo de la ficha). Cambiar el precio o el código de almacén pide un alcance:
--      ahora   = solo la ficha (los requerimientos existentes no cambian);
--      tramite = además las líneas de requerimientos Pendiente u Observado (los editables);
--      todos   = además las de Atendido (solo superadmin; puede no coincidir con lo ya cargado en SIDIGE).
--    Cada cambio queda en private.admin_catalog_audit (acción CAMBIAR_FICHA) con las líneas afectadas y sus
--    valores anteriores. Los totales se calculan en vivo, no hay nada que recalcular.
-- 3. Importación: el género actualiza la asignación del cliente sin alerta; si el archivo trae una sola renovación
--    para una prenda, reemplaza la renovación vigente (AMBOS <-> VERANO/INVIERNO) y la vista previa lo informa.
begin;

-- ===== 1. género en la asignación =====
create table private.prendas_genero_respaldo as select p.id as prenda_id,p.codigo_prenda,p.genero,now() as respaldado_at from public.prendas p;
revoke all on private.prendas_genero_respaldo from public,anon,authenticated;

alter table public.prenda_clientes add column genero text not null default 'AMBOS';
update public.prenda_clientes a set genero=p.genero from public.prendas p where p.id=a.prenda_id;
alter table public.prenda_clientes alter column genero drop default;
alter table public.prenda_clientes add constraint prenda_clientes_genero_valido check (genero in ('HOMBRE','MUJER','AMBOS'));
create trigger normalizar_genero_asignacion before insert or update of genero on public.prenda_clientes
  for each row execute function public.normalizar_genero_prenda();
drop trigger normalizar_genero_prenda on public.prendas;
alter table public.prendas drop column genero;
comment on column public.prenda_clientes.genero is 'HOMBRE, MUJER o AMBOS para ESTE cliente (una misma prenda puede ser HOMBRE para un cliente y AMBOS para otro).';

-- Ficha + asignaciones como json (auditoría y respuesta de Mantenimiento).
create or replace function private.prenda_json(p_id uuid) returns jsonb language sql stable
set search_path=pg_catalog,public,pg_temp as $$
  select to_jsonb(p.*) || jsonb_build_object('asignaciones',coalesce((
    select jsonb_agg(jsonb_build_object('id',a.id,'cliente_id',a.cliente_id,'cliente',c.nombre,'renovacion',a.renovacion,
      'genero',a.genero,'cantidad',a.cantidad,'activo',a.activo) order by c.nombre,a.renovacion)
    from public.prenda_clientes a join public.clientes c on c.id=a.cliente_id where a.prenda_id=p.id),'[]'::jsonb))
  from public.prendas p where p.id=p_id;
$$;

-- Prendas que el formulario ofrece: ahora con el género de la asignación.
create or replace function public.listar_prendas_cliente(p_cliente_id uuid,p_renovacion text)
returns table(id uuid,codigo_prenda text,nombre_prenda text,codigo_almacen text,precio numeric,genero text,
  cantidad integer,renovacion text,activo boolean)
language plpgsql stable security invoker set search_path=pg_catalog,public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_cliente_id is null or p_renovacion is null or p_renovacion not in ('VERANO','INVIERNO') then
    raise exception 'Cliente o renovación inválidos' using errcode='22023';
  end if;
  return query
    select p.id,p.codigo_prenda,p.nombre_prenda,p.codigo_almacen,p.precio,a.genero,a.cantidad,a.renovacion,p.activo
    from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id
    where a.cliente_id=p_cliente_id and a.activo and p.activo and a.renovacion in (p_renovacion,'AMBOS')
    order by p.nombre_prenda,p.id;
end $$;

-- ===== 2. impacto y aplicación de cambios de precio / código de almacén =====
alter table private.admin_catalog_audit drop constraint if exists admin_catalog_audit_accion_check;
alter table private.admin_catalog_audit add constraint admin_catalog_audit_accion_check
  check (accion in ('CREAR','EDITAR','ACTIVAR','DESACTIVAR','ELIMINAR','IMPORTAR','CAMBIAR_FICHA'));

-- Las líneas guardan una copia de precio y código de almacén; solo la función de cambio de ficha puede
-- modificarlas (marca la transacción con app.cambio_ficha). El resto del historial sigue inmutable.

create or replace function public.proteger_historial_detalle()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $$
begin
  if tg_op='DELETE' then
    if pg_catalog.current_setting('app.test_requirement_deletion',true)='on'
      and auth.uid() is not null and public.is_admin() then
      return old;
    end if;
    raise exception 'Las prendas se retiran mediante baja lógica; no se permite borrar el historial';
  end if;
  if not old.activo then raise exception 'Las líneas retiradas son inmutables'; end if;
  if new.id is distinct from old.id or new.requerimiento_id is distinct from old.requerimiento_id
    or new.prenda_id is distinct from old.prenda_id or new.created_at is distinct from old.created_at
    or (coalesce(current_setting('app.cambio_ficha',true),'')<>'1'
      and (new.precio_unitario is distinct from old.precio_unitario or new.codigo_almacen is distinct from old.codigo_almacen))
    or (not new.activo and new.cantidad is distinct from old.cantidad) then
    raise exception 'No se permite alterar los valores históricos de la línea';
  end if;
  return new;
end $$;


-- Cuántas líneas/requerimientos cambiarían si el precio o el código de almacén pasan a los valores indicados.
create function private.impacto_cambio_ficha(p_prenda_id uuid,p_precio numeric,p_codigo_almacen text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_p public.prendas; v_precio boolean; v_alm boolean; v_res jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  select * into v_p from public.prendas where id=p_prenda_id;
  if not found then raise exception 'Prenda no encontrada' using errcode='P0002'; end if;
  v_precio:=p_precio is not null and p_precio is distinct from v_p.precio;
  v_alm:=p_codigo_almacen is not null and btrim(p_codigo_almacen) is distinct from v_p.codigo_almacen;
  select jsonb_build_object('precio_cambia',v_precio,'almacen_cambia',v_alm,
    'tramite',jsonb_build_object('requerimientos',count(distinct r.id) filter(where r.estado in ('Pendiente','Observado')),
      'lineas',count(*) filter(where r.estado in ('Pendiente','Observado'))),
    'todos',jsonb_build_object('requerimientos',count(distinct r.id),'lineas',count(*)))
  into v_res
  from public.detalle_requerimiento d join public.requerimientos r on r.id=d.requerimiento_id
  where d.prenda_id=p_prenda_id and d.activo
    and ((v_precio and d.precio_unitario<>p_precio) or (v_alm and d.codigo_almacen<>btrim(p_codigo_almacen)));
  return v_res;
end $$;
revoke all on function private.impacto_cambio_ficha(uuid,numeric,text) from public,anon,authenticated;
grant execute on function private.impacto_cambio_ficha(uuid,numeric,text) to authenticated;
create function public.admin_impacto_cambio_ficha(p_prenda_id uuid,p_precio numeric,p_codigo_almacen text) returns jsonb
language sql stable security invoker set search_path=pg_catalog,pg_temp as $$
  select private.impacto_cambio_ficha(p_prenda_id,p_precio,p_codigo_almacen);
$$;
revoke all on function public.admin_impacto_cambio_ficha(uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.admin_impacto_cambio_ficha(uuid,numeric,text) to authenticated;

-- Aplica precio / código de almacén / nombre a la ficha con el alcance elegido y lo audita.
create function private.aplicar_cambio_ficha(p_prenda_id uuid,p_precio numeric,p_codigo_almacen text,p_nombre text,
  p_alcance text,p_origen text) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_old public.prendas; v_precio boolean; v_alm boolean; v_nombre boolean; v_lineas jsonb:='[]'::jsonb; v_req integer:=0; v_n integer:=0;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_alcance is null or p_alcance not in ('ahora','tramite','todos') then raise exception 'Alcance inválido' using errcode='22023'; end if;
  if p_alcance='todos' and not public.is_superadmin() then
    raise exception 'Solo un superadmin puede aplicar el cambio a todos los requerimientos' using errcode='42501'; end if;
  select * into v_old from public.prendas where id=p_prenda_id for update;
  if not found then raise exception 'Prenda no encontrada' using errcode='P0002'; end if;
  v_precio:=p_precio is not null and p_precio is distinct from v_old.precio;
  v_alm:=p_codigo_almacen is not null and btrim(p_codigo_almacen) is distinct from v_old.codigo_almacen;
  v_nombre:=p_nombre is not null and btrim(p_nombre) is distinct from v_old.nombre_prenda;
  if not (v_precio or v_alm or v_nombre) then return jsonb_build_object('alcance',p_alcance,'requerimientos',0,'lineas',0); end if;
  if p_alcance<>'ahora' and (v_precio or v_alm) then
    select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'requerimiento_id',x.requerimiento_id,'estado',x.estado,
        'precio_anterior',x.precio_unitario,'codigo_almacen_anterior',x.codigo_almacen) order by x.id),'[]'::jsonb),
      count(distinct x.requerimiento_id),count(*)
    into v_lineas,v_req,v_n from (
      select d.id,d.requerimiento_id,r.estado,d.precio_unitario,d.codigo_almacen
      from public.detalle_requerimiento d join public.requerimientos r on r.id=d.requerimiento_id
      where d.prenda_id=p_prenda_id and d.activo and (p_alcance='todos' or r.estado in ('Pendiente','Observado'))
        and ((v_precio and d.precio_unitario<>p_precio) or (v_alm and d.codigo_almacen<>btrim(p_codigo_almacen)))
      for update of d) x;
    perform set_config('app.cambio_ficha','1',true);
    update public.detalle_requerimiento d set
      precio_unitario=case when v_precio then p_precio else d.precio_unitario end,
      codigo_almacen=case when v_alm then btrim(p_codigo_almacen) else d.codigo_almacen end
    where d.id in (select (e->>'id')::uuid from jsonb_array_elements(v_lineas) e);
    perform set_config('app.cambio_ficha','',true);
  end if;
  update public.prendas set precio=case when v_precio then p_precio else precio end,
    codigo_almacen=case when v_alm then btrim(p_codigo_almacen) else codigo_almacen end,
    nombre_prenda=case when v_nombre then btrim(p_nombre) else nombre_prenda end
  where id=p_prenda_id;
  insert into private.admin_catalog_audit(usuario_id,accion,catalogo,registro_id,valores_antes,valores_despues)
  values(auth.uid(),'CAMBIAR_FICHA','prendas',p_prenda_id,
    jsonb_build_object('codigo_prenda',v_old.codigo_prenda,'precio',v_old.precio,'codigo_almacen',v_old.codigo_almacen,'nombre_prenda',v_old.nombre_prenda),
    jsonb_build_object('origen',p_origen,'alcance',p_alcance,
      'precio',case when v_precio then p_precio else v_old.precio end,
      'codigo_almacen',case when v_alm then btrim(p_codigo_almacen) else v_old.codigo_almacen end,
      'nombre_prenda',case when v_nombre then btrim(p_nombre) else v_old.nombre_prenda end,
      'requerimientos_afectados',v_req,'lineas_afectadas',v_n,'lineas',v_lineas));
  return jsonb_build_object('alcance',p_alcance,'requerimientos',v_req,'lineas',v_n);
end $$;
revoke all on function private.aplicar_cambio_ficha(uuid,numeric,text,text,text,text) from public,anon,authenticated;
grant execute on function private.aplicar_cambio_ficha(uuid,numeric,text,text,text,text) to authenticated;

drop function public.crear_requerimiento(uuid,uuid,uuid,text,jsonb,uuid);
create function public.crear_requerimiento(
  p_agente_id uuid,p_cliente_id uuid,p_unidad_id uuid,p_renovacion text,p_detalles jsonb,p_request_id uuid,p_genero text
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
      and a.renovacion in (p_renovacion,'AMBOS') and a.genero in (p_genero,'AMBOS')
    order by a.id for share of a,p;
  get diagnostics v_count=row_count;
  if v_count<>cardinality(v_prendas) then
    raise exception 'La prenda no corresponde al cliente, la renovación ni el género seleccionados, o está inactiva' using errcode='22023';
  end if;
  insert into public.requerimientos(agente_id,usuario_creador_id,cliente_id,unidad_id,renovacion,referencia_interna,request_id)
    values(p_agente_id,auth.uid(),p_cliente_id,p_unidad_id,p_renovacion,'RENOVACION '||p_renovacion,p_request_id) returning id into v_id;
  insert into public.detalle_requerimiento(requerimiento_id,prenda_id,cantidad,precio_unitario,codigo_almacen)
    select v_id,p.id,a.cantidad,p.precio,p.codigo_almacen from public.prendas p
    join public.prenda_clientes a on a.prenda_id=p.id and a.cliente_id=p_cliente_id and a.activo
      and a.renovacion in (p_renovacion,'AMBOS') and a.genero in (p_genero,'AMBOS')
    where p.id=any(v_prendas);
  return v_id;
end;
$$;
revoke all on function public.crear_requerimiento(uuid,uuid,uuid,text,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.crear_requerimiento(uuid,uuid,uuid,text,jsonb,uuid,text) to authenticated;

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
      jsonb_build_object('cantidad',coalesce(a.cantidad,d.cantidad),'renovacion',coalesce(a.renovacion,v_row.renovacion),'genero',coalesce(a.genero,'AMBOS')))
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

drop function public.editar_prendas_requerimiento(uuid,text,jsonb);
create function public.editar_prendas_requerimiento(p_id uuid,p_version text,p_detalles jsonb,p_genero text default null)
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
        and a.renovacion in (v_row.renovacion,'AMBOS') and (p_genero is null or a.genero in (p_genero,'AMBOS')))) then
    raise exception 'La prenda no corresponde al cliente, la renovación ni el género, o está inactiva' using errcode='22023';
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
revoke all on function public.editar_prendas_requerimiento(uuid,text,jsonb,text) from public,anon;
grant execute on function public.editar_prendas_requerimiento(uuid,text,jsonb,text) to authenticated;

create or replace function private.admin_guardar_catalogo(p_catalogo text,p_id uuid,p_valores jsonb)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_antes jsonb; v_despues jsonb; v_nombre text; v_codigo text;
  v_cliente_id uuid; v_cliente_nombre text; v_cliente_activo boolean; v_prenda_id uuid; v_a jsonb; v_alcance text; v_impacto jsonb; v_precio numeric; v_almacen text;
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
        if jsonb_typeof(v_a)<>'object' or (v_a-'id'-'cliente_id'-'renovacion'-'genero'-'cantidad'-'activo')<>'{}'::jsonb
          or v_a->>'renovacion' is null or v_a->>'renovacion' not in ('VERANO','INVIERNO','AMBOS')
          or v_a->>'genero' is null or v_a->>'genero' not in ('HOMBRE','MUJER','AMBOS')
          or (v_a->>'cantidad')!~'^[1-9][0-9]{0,4}$' or (v_a->>'cantidad')::integer>10000
          or jsonb_typeof(v_a->'activo')<>'boolean' then
          raise exception 'Revisa las asignaciones: cliente, renovación, género, cantidad y estado' using errcode='22023';
        end if;
        begin
          if v_a->>'id' is not null then
            update public.prenda_clientes set renovacion=v_a->>'renovacion',genero=v_a->>'genero',cantidad=(v_a->>'cantidad')::integer,activo=(v_a->>'activo')::boolean
              where id=(v_a->>'id')::uuid and prenda_id=v_prenda_id
                and (v_a->>'cliente_id' is null or cliente_id=(v_a->>'cliente_id')::uuid);
            if not found then raise exception 'Asignación no encontrada' using errcode='P0002'; end if;
          else
            begin v_cliente_id:=(v_a->>'cliente_id')::uuid;
            exception when invalid_text_representation then raise exception 'Selecciona un cliente válido' using errcode='22023'; end;
            select c.nombre,c.activo into v_cliente_nombre,v_cliente_activo from public.clientes c where c.id=v_cliente_id for share;
            if not found then raise exception 'Cliente no encontrado' using errcode='P0002'; end if;
            if not v_cliente_activo and (v_a->>'activo')::boolean then raise exception 'Selecciona un cliente activo' using errcode='55000'; end if;
            insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,genero,cantidad,activo)
              values(v_prenda_id,v_cliente_id,v_a->>'renovacion',v_a->>'genero',(v_a->>'cantidad')::integer,(v_a->>'activo')::boolean);
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
        exists(select 1 from public.prenda_clientes a where a.prenda_id=p.id
          and (p_cliente_id is null or a.cliente_id=p_cliente_id) and (p_genero is null or a.genero=p_genero))
        and (v_q='' or position(v_q in lower(concat_ws(' ',p.codigo_prenda,p.nombre_prenda,p.codigo_almacen)))>0);
      select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre_prenda,x.id),'[]') into v_rows from (
        select p.id,p.codigo_prenda,p.nombre_prenda,p.codigo_almacen,p.precio,p.activo,
          coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'cliente_id',a.cliente_id,'cliente',c.nombre,
            'renovacion',a.renovacion,'genero',a.genero,'cantidad',a.cantidad,'activo',a.activo) order by c.nombre,a.renovacion)
            from public.prenda_clientes a join public.clientes c on c.id=a.cliente_id where a.prenda_id=p.id),'[]'::jsonb) asignaciones
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
end $$;

create or replace function public.listar_requerimientos_filtrados(
  p_cliente_id uuid default null,p_unidad_id uuid default null,p_estado public.estado_requerimiento default null,
  p_genero text default null,p_prendas_min integer default null,p_prendas_max integer default null,
  p_unidades_min integer default null,p_unidades_max integer default null,p_busqueda text default null,
  p_limite integer default 50,p_offset integer default 0,p_renovacion text default null
) returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog,public,pg_temp as $$
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
    select r.id,r.fecha,r.referencia_interna,r.estado,r.renovacion,r.usuario_creador_id,r.cliente_id,r.unidad_id,
      case when p.id is not null then jsonb_build_object('nombre',p.nombre,'dni',p.dni,'cargo',p.cargo) end personal,
      case when c.id is not null then jsonb_build_object('nombre',c.nombre) end clientes,
      case when u.id is not null then jsonb_build_object('nombre',u.nombre) end unidades,
      coalesce(d.cantidad_prendas,0) cantidad_prendas,coalesce(d.unidades_totales,0) unidades_totales,
      coalesce(d.total_requerimiento,0) total_requerimiento,coalesce(d.generos,'{}'::text[]) generos
    from public.requerimientos r
    left join public.personal p on p.id=r.agente_id left join public.clientes c on c.id=r.cliente_id
    left join public.unidades u on u.id=r.unidad_id
    left join lateral (
      select count(*)::integer cantidad_prendas,coalesce(sum(dr.cantidad),0)::integer unidades_totales,
        coalesce(sum(dr.cantidad*dr.precio_unitario),0)::numeric total_requerimiento,
        coalesce(array_agg(distinct g.genero) filter(where g.genero is not null),'{}'::text[]) generos
      from public.detalle_requerimiento dr left join lateral (select a.genero from public.prenda_clientes a where a.prenda_id=dr.prenda_id and a.cliente_id=r.cliente_id and a.renovacion in (r.renovacion,'AMBOS') order by a.activo desc,a.updated_at desc limit 1) g on true
      where dr.requerimiento_id=r.id and dr.activo
    ) d on true where r.usuario_creador_id=auth.uid()
  ), filtered as (
    select * from rows x where (p_cliente_id is null or x.cliente_id=p_cliente_id)
      and (p_unidad_id is null or x.unidad_id=p_unidad_id) and (p_estado is null or x.estado=p_estado)
      and (p_renovacion is null or x.renovacion=p_renovacion)
      and (p_prendas_min is null or x.cantidad_prendas>=p_prendas_min) and (p_prendas_max is null or x.cantidad_prendas<=p_prendas_max)
      and (p_unidades_min is null or x.unidades_totales>=p_unidades_min) and (p_unidades_max is null or x.unidades_totales<=p_unidades_max)
      and (p_genero is null or (p_genero='HOMBRE' and x.generos&&array['HOMBRE','AMBOS'])
        or (p_genero='MUJER' and x.generos&&array['MUJER','AMBOS']) or (p_genero='AMBOS' and 'AMBOS'=any(x.generos)))
      and (nullif(trim(p_busqueda),'') is null or position(lower(trim(p_busqueda)) in lower(concat_ws(' ',x.personal->>'nombre',x.personal->>'dni',x.clientes->>'nombre',x.unidades->>'nombre',x.referencia_interna,x.id::text)))>0)
  )
  select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(x) order by x.fecha desc,x.id desc)
    from (select * from filtered order by fecha desc,id desc limit p_limite offset p_offset) x),'[]'::jsonb)) into v_result;
  return v_result;
end $$;

create or replace function public.admin_consultar_requerimientos_v2(
  p_cliente_id uuid default null,p_unidad_id uuid default null,p_coordinador_id uuid default null,
  p_estado public.estado_requerimiento default null,p_desde timestamptz default null,p_hasta timestamptz default null,
  p_busqueda text default null,p_genero text default null,p_unidades_min integer default null,p_unidades_max integer default null,
  p_solo_duplicados boolean default false,p_orden text default 'fecha',p_direccion text default 'desc',
  p_limite integer default 50,p_offset integer default 0,p_exportar boolean default false,
  p_cursor_fecha timestamptz default null,p_cursor_id uuid default null,p_creado_hasta timestamptz default null,
  p_renovacion text default null
) returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog,public,pg_temp as $$
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
    select r.id,r.fecha,r.created_at,r.referencia_interna,r.estado,r.renovacion,r.agente_id,r.cliente_id,r.unidad_id,r.usuario_creador_id,
      jsonb_build_object('nombre',p.nombre,'dni',p.dni,'cargo',p.cargo) personal,
      case when c.id is not null then jsonb_build_object('nombre',c.nombre) end clientes,
      case when u.id is not null then jsonb_build_object('nombre',u.nombre) end unidades,
      jsonb_build_object('nombre',pr.nombre,'email',pr.email) profiles,
      lower(coalesce(p.nombre,'')) agente_orden,lower(coalesce(c.nombre,'')) cliente_orden,
      lower(coalesce(u.nombre,'')) unidad_orden,lower(coalesce(pr.nombre,pr.email,'')) coordinador_orden,
      coalesce(d.cantidad_prendas,0) cantidad_prendas,coalesce(d.unidades_totales,0) unidades_totales,
      coalesce(d.total_requerimiento,0) total_requerimiento,coalesce(d.generos,'{}'::text[]) generos
    from public.requerimientos r left join public.personal p on p.id=r.agente_id
    left join public.clientes c on c.id=r.cliente_id left join public.unidades u on u.id=r.unidad_id
    left join public.profiles pr on pr.id=r.usuario_creador_id
    left join lateral (
      select count(*)::integer cantidad_prendas,coalesce(sum(dr.cantidad),0)::integer unidades_totales,
        coalesce(sum(dr.cantidad*dr.precio_unitario),0)::numeric total_requerimiento,
        coalesce(array_agg(distinct g.genero) filter(where g.genero is not null),'{}'::text[]) generos
      from public.detalle_requerimiento dr left join lateral (select a.genero from public.prenda_clientes a where a.prenda_id=dr.prenda_id and a.cliente_id=r.cliente_id and a.renovacion in (r.renovacion,'AMBOS') order by a.activo desc,a.updated_at desc limit 1) g on true
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
      and (p_estado is null or a.estado=p_estado) and (p_renovacion is null or a.renovacion=p_renovacion) and (p_desde is null or a.fecha>=p_desde) and (p_hasta is null or a.fecha<p_hasta)
      and (p_creado_hasta is null or a.created_at<=p_creado_hasta)
      and (p_unidades_min is null or a.unidades_totales>=p_unidades_min) and (p_unidades_max is null or a.unidades_totales<=p_unidades_max)
      and (p_genero is null or (p_genero='HOMBRE' and a.generos&&array['HOMBRE','AMBOS'])
        or (p_genero='MUJER' and a.generos&&array['MUJER','AMBOS']) or (p_genero='AMBOS' and 'AMBOS'=any(a.generos)))
      and (nullif(trim(p_busqueda),'') is null or position(lower(trim(p_busqueda)) in lower(concat_ws(' ',a.personal->>'nombre',a.personal->>'dni',a.clientes->>'nombre',a.unidades->>'nombre',a.profiles->>'nombre',a.profiles->>'email',a.id::text)))>0)
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
end $$;


drop function public.admin_importar_prendas(uuid,jsonb,boolean,text[],boolean);
drop function private.admin_importar_prendas(uuid,jsonb,boolean,text[],boolean);
-- p_actualizar: objeto {codigo: alcance} con alcance ahora|tramite|todos para las fichas cuyos datos (precio,
-- nombre, código de almacén) se actualizan con los del archivo. El género es de la asignación del cliente.
create function private.admin_importar_prendas(p_cliente_id uuid,p_filas jsonb,p_aplicar boolean,
  p_actualizar jsonb default '{}'::jsonb,p_reemplazar boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  v_cliente text; v_f jsonb; v_alertas jsonb; v_desactivar jsonb; v_inactivas jsonb; v_renov jsonb; v_cambios jsonb:='[]'::jsonb;
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
  select c.nombre into v_cliente from public.clientes c where c.id=p_cliente_id and c.activo for share;
  if not found then raise exception 'Selecciona un cliente activo' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('importar_prendas:'||p_cliente_id::text,0));

  select jsonb_agg(to_jsonb(x)) into v_f from private.prendas_import_filas(p_filas) x;
  drop table if exists pg_temp.imp_f; drop table if exists pg_temp.imp_repl; drop table if exists pg_temp.imp_sitio;
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
    having count(distinct (nombre_prenda,codigo_almacen,precio))>1) then
    raise exception 'El archivo trae datos distintos de ficha para un mismo código' using errcode='22023'; end if;

  -- Asignaciones VIGENTES del cliente que chocan con las renovaciones que trae el archivo para ese código
  -- (AMBOS contra VERANO/INVIERNO): el archivo manda y las reemplaza. Con una sola fila en el archivo y una sola
  -- asignación vigente en conflicto, se cambia su renovación en el lugar (AMBOS -> VERANO o al revés).
  create temp table imp_repl on commit drop as
    select a.id as asignacion_id,p.codigo_prenda,p.nombre_prenda,a.renovacion as de,
      (select string_agg(distinct f.renovacion,' y ' order by f.renovacion) from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda) as a_renovacion
    from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id
    where a.cliente_id=p_cliente_id and a.activo
      and exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.renovacion<>a.renovacion
        and (a.renovacion='AMBOS' or f.renovacion='AMBOS'))
      and not exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.renovacion=a.renovacion);
  create temp table imp_sitio on commit drop as
    select r.asignacion_id,f.fila,f.renovacion as nueva
    from pg_temp.imp_repl r join pg_temp.imp_f f on f.codigo_prenda=r.codigo_prenda
    where (select count(*) from pg_temp.imp_f x where x.codigo_prenda=r.codigo_prenda)=1
      and (select count(*) from pg_temp.imp_repl y where y.codigo_prenda=r.codigo_prenda)=1
      and not exists(select 1 from public.prenda_clientes e join public.prendas pe on pe.id=e.prenda_id
        where e.cliente_id=p_cliente_id and pe.codigo_prenda=r.codigo_prenda and e.renovacion=f.renovacion);
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
      left join public.prenda_clientes a on a.prenda_id=p.id and a.cliente_id=p_cliente_id and a.renovacion=o.renovacion
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
    'cantidad',a.cantidad) order by p.codigo_prenda,a.renovacion),'[]'::jsonb) into v_desactivar
  from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id
  where p_reemplazar and a.cliente_id=p_cliente_id and a.activo
    and not exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.renovacion=a.renovacion)
    and not exists(select 1 from pg_temp.imp_sitio s where s.asignacion_id=a.id);

  if p_aplicar then
    select coalesce(jsonb_agg(jsonb_build_object('codigo',p.codigo_prenda,'renovacion',a.renovacion,'genero',a.genero,'cantidad',a.cantidad,'activo',a.activo)
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
        and a.renovacion=o.renovacion and not o.activo and a.activo;
    update public.prenda_clientes a set activo=false from public.prendas p
      where p_reemplazar and p.id=a.prenda_id and a.cliente_id=p_cliente_id and a.activo
        and not exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.renovacion=a.renovacion)
        and not exists(select 1 from pg_temp.imp_sitio s where s.asignacion_id=a.id);
    insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,genero,cantidad,activo)
      select p.id,p_cliente_id,o.renovacion,o.genero,o.cantidad,false from pg_temp.imp_f o
      join public.prendas p on p.codigo_prenda=o.codigo_prenda where not o.activo
      on conflict (prenda_id,cliente_id,renovacion) do update set cantidad=excluded.cantidad,genero=excluded.genero;
    insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,genero,cantidad,activo)
      select p.id,p_cliente_id,o.renovacion,o.genero,o.cantidad,true from pg_temp.imp_f o
      join public.prendas p on p.codigo_prenda=o.codigo_prenda where o.activo
      on conflict (prenda_id,cliente_id,renovacion) do update set cantidad=excluded.cantidad,genero=excluded.genero,activo=true;

    insert into private.admin_catalog_audit(usuario_id,accion,catalogo,registro_id,valores_antes,valores_despues)
    values(auth.uid(),'IMPORTAR','prendas',p_cliente_id,v_antes,jsonb_build_object('cliente',v_cliente,'reemplazar',p_reemplazar,
      'actualizar_fichas',p_actualizar,'cambios_ficha',v_cambios,'prendas_nuevas',v_prendas_nuevas,'asignaciones_nuevas',v_nuevas,
      'cantidades_actualizadas',v_cantidad,'generos_actualizados',v_genero,'renovaciones_actualizadas',v_renov,
      'estados_actualizados',v_estado,'desactivadas',jsonb_array_length(v_desactivar),
      'filas',(select coalesce(jsonb_agg(jsonb_build_object('codigo',o.codigo_prenda,'renovacion',o.renovacion,'genero',o.genero,'cantidad',o.cantidad,'activo',o.activo)
        order by o.fila),'[]'::jsonb) from pg_temp.imp_f o)));
  end if;

  return jsonb_build_object('aplicado',p_aplicar,'cliente',v_cliente,'prendas_nuevas',v_prendas_nuevas,
    'asignaciones_nuevas',v_nuevas,'cantidades_actualizadas',v_cantidad,'generos_actualizados',v_genero,
    'estados_actualizados',v_estado,'sin_cambios',v_igual,'renovaciones_actualizadas',v_renov,
    'alertas',v_alertas,'desactivar',v_desactivar,'fichas_inactivas',v_inactivas,'cambios_ficha',v_cambios);
end $$;
revoke all on function private.admin_importar_prendas(uuid,jsonb,boolean,jsonb,boolean) from public,anon,authenticated;
grant execute on function private.admin_importar_prendas(uuid,jsonb,boolean,jsonb,boolean) to authenticated;
create function public.admin_importar_prendas(p_cliente_id uuid,p_filas jsonb,p_aplicar boolean default false,
  p_actualizar jsonb default '{}'::jsonb,p_reemplazar boolean default false) returns jsonb
language sql volatile security invoker set search_path=pg_catalog,pg_temp as $$
  select private.admin_importar_prendas(p_cliente_id,p_filas,p_aplicar,p_actualizar,p_reemplazar);
$$;
revoke all on function public.admin_importar_prendas(uuid,jsonb,boolean,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.admin_importar_prendas(uuid,jsonb,boolean,jsonb,boolean) to authenticated;

notify pgrst,'reload schema';
commit;
