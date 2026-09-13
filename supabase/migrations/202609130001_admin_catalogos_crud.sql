-- CRUD administrativo seguro. Ejecutar después de 202609100003.
-- No elimina históricos, no desactiva RLS y no modifica SIDIGE.
begin;

create table if not exists private.admin_catalog_audit (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null,
  accion text not null check (accion in ('CREAR','EDITAR','ACTIVAR','DESACTIVAR','ELIMINAR')),
  catalogo text not null check (catalogo in ('clientes','unidades','personal','prendas')),
  registro_id uuid not null,
  valores_antes jsonb,
  valores_despues jsonb,
  created_at timestamptz not null default now()
);
revoke all on private.admin_catalog_audit from public,anon,authenticated;
create index if not exists admin_catalog_audit_registro_fecha_idx
  on private.admin_catalog_audit(catalogo,registro_id,created_at desc);

-- Si ya existen duplicados con distinta capitalización, la migración falla sin modificar datos.
create unique index if not exists clientes_nombre_ci_uidx
  on public.clientes(lower(btrim(nombre)));
create unique index if not exists unidades_cliente_nombre_ci_uidx
  on public.unidades(cliente_id,lower(btrim(nombre)));

create function private.admin_guardar_catalogo(p_catalogo text,p_id uuid,p_valores jsonb)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_antes jsonb; v_despues jsonb; v_nombre text; v_codigo text;
  v_cliente_id uuid; v_cliente_nombre text; v_cliente_activo boolean;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_catalogo not in ('clientes','unidades','personal','prendas') or p_valores is null
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
        -- Campo de compatibilidad: mantener el catálogo de prendas alineado al renombrar.
        update public.prendas set cliente=v_nombre where cliente=v_antes->>'nombre';
      end if;

    when 'unidades' then
      if (p_valores-'nombre'-'cliente_id')<>'{}'::jsonb then raise exception 'Campos de unidad inválidos' using errcode='22023'; end if;
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
        insert into public.unidades(cliente_id,nombre,activo) values(v_cliente_id,v_nombre,true)
          returning to_jsonb(unidades.*) into v_despues;
      else
        select to_jsonb(u.*) into v_antes from public.unidades u where u.id=p_id for update;
        if v_antes is null then raise exception 'Unidad no encontrada' using errcode='P0002'; end if;
        if (v_antes->>'cliente_id')::uuid<>v_cliente_id
          and exists(select 1 from public.requerimientos r where r.unidad_id=p_id) then
          raise exception 'Una unidad utilizada en requerimientos no puede cambiar de cliente' using errcode='55000';
        end if;
        update public.unidades set cliente_id=v_cliente_id,nombre=v_nombre where id=p_id
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
      if (p_valores-'codigo_prenda'-'nombre_prenda'-'codigo_almacen'-'precio'-'cantidad'-'cliente_id'-'genero')<>'{}'::jsonb then
        raise exception 'Campos de prenda inválidos' using errcode='22023';
      end if;
      v_codigo:=btrim(p_valores->>'codigo_prenda'); v_nombre:=btrim(p_valores->>'nombre_prenda');
      begin v_cliente_id:=(p_valores->>'cliente_id')::uuid;
      exception when invalid_text_representation then raise exception 'Selecciona un cliente válido' using errcode='22023'; end;
      select c.nombre,c.activo into v_cliente_nombre,v_cliente_activo from public.clientes c where c.id=v_cliente_id for share;
      if not found then raise exception 'Cliente no encontrado' using errcode='P0002'; end if;
      if not v_cliente_activo and (p_id is null or not exists(
        select 1 from public.prendas p where p.id=p_id and p.cliente=v_cliente_nombre
      )) then raise exception 'Selecciona un cliente activo' using errcode='55000'; end if;
      if nullif(v_codigo,'') is null or length(v_codigo)>80 or nullif(v_nombre,'') is null or length(v_nombre)>240
        or nullif(btrim(p_valores->>'codigo_almacen'),'') is null or length(btrim(p_valores->>'codigo_almacen'))>80
        or (p_valores->>'precio')!~'^[0-9]+([.][0-9]{1,2})?$' or (p_valores->>'precio')::numeric<0
        or (p_valores->>'precio')::numeric>9999999999.99
        or (p_valores->>'cantidad')!~'^[1-9][0-9]*$' or (p_valores->>'cantidad')::integer>10000
        or p_valores->>'genero' not in ('HOMBRE','MUJER','AMBOS') then
        raise exception 'Revisa código, nombre, almacén, precio, cantidad y género' using errcode='22023';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('prenda:'||lower(v_codigo),0));
      if exists(select 1 from public.prendas p where lower(btrim(p.codigo_prenda))=lower(v_codigo) and p.id is distinct from p_id) then
        raise exception 'Ya existe una prenda con ese código' using errcode='23505';
      end if;
      if p_id is null then
        insert into public.prendas(codigo_prenda,nombre_prenda,codigo_almacen,precio,cantidad,cliente,genero,activo)
        values(v_codigo,v_nombre,btrim(p_valores->>'codigo_almacen'),(p_valores->>'precio')::numeric,
          (p_valores->>'cantidad')::integer,v_cliente_nombre,p_valores->>'genero',true)
        returning to_jsonb(prendas.*) into v_despues;
      else
        select to_jsonb(p.*) into v_antes from public.prendas p where p.id=p_id for update;
        if v_antes is null then raise exception 'Prenda no encontrada' using errcode='P0002'; end if;
        update public.prendas set codigo_prenda=v_codigo,nombre_prenda=v_nombre,
          codigo_almacen=btrim(p_valores->>'codigo_almacen'),precio=(p_valores->>'precio')::numeric,
          cantidad=(p_valores->>'cantidad')::integer,cliente=v_cliente_nombre,genero=p_valores->>'genero'
        where id=p_id returning to_jsonb(prendas.*) into v_despues;
      end if;
  end case;

  insert into private.admin_catalog_audit(usuario_id,accion,catalogo,registro_id,valores_antes,valores_despues)
  values(auth.uid(),case when p_id is null then 'CREAR' else 'EDITAR' end,p_catalogo,
    (v_despues->>'id')::uuid,v_antes,v_despues);
  return jsonb_build_object('accion',case when p_id is null then 'crear' else 'editar' end,'row',v_despues);
end $$;
revoke all on function private.admin_guardar_catalogo(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.admin_guardar_catalogo(text,uuid,jsonb) to authenticated;
create function public.admin_guardar_catalogo(p_catalogo text,p_id uuid,p_valores jsonb)
returns jsonb language sql volatile security invoker set search_path=pg_catalog,pg_temp as $$
  select private.admin_guardar_catalogo(p_catalogo,p_id,p_valores);
$$;
revoke all on function public.admin_guardar_catalogo(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admin_guardar_catalogo(text,uuid,jsonb) to authenticated;

create or replace function private.admin_actualizar_catalogo_activo(p_catalogo text,p_id uuid,p_activo boolean)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_antes jsonb; v_despues jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_catalogo not in ('clientes','unidades','personal','prendas') or p_id is null or p_activo is null then
    raise exception 'Datos inválidos' using errcode='22023';
  end if;
  case p_catalogo
    when 'clientes' then select to_jsonb(c.*) into v_antes from public.clientes c where c.id=p_id for update;
    when 'unidades' then select to_jsonb(u.*) into v_antes from public.unidades u where u.id=p_id for update;
    when 'personal' then select to_jsonb(p.*) into v_antes from public.personal p where p.id=p_id for update;
    when 'prendas' then select to_jsonb(p.*) into v_antes from public.prendas p where p.id=p_id for update;
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
  end case;
  insert into private.admin_catalog_audit(usuario_id,accion,catalogo,registro_id,valores_antes,valores_despues)
  values(auth.uid(),case when p_activo then 'ACTIVAR' else 'DESACTIVAR' end,p_catalogo,p_id,v_antes,v_despues);
  return v_despues;
end $$;
revoke all on function private.admin_actualizar_catalogo_activo(text,uuid,boolean) from public,anon,authenticated;
grant execute on function private.admin_actualizar_catalogo_activo(text,uuid,boolean) to authenticated;

create function private.admin_eliminar_catalogo(p_catalogo text,p_id uuid)
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
      or exists(select 1 from public.prendas p where lower(btrim(p.cliente))=lower(btrim(v_antes->>'nombre')))
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
revoke all on function private.admin_eliminar_catalogo(text,uuid) from public,anon,authenticated;
grant execute on function private.admin_eliminar_catalogo(text,uuid) to authenticated;
create function public.admin_eliminar_catalogo(p_catalogo text,p_id uuid)
returns jsonb language sql volatile security invoker set search_path=pg_catalog,pg_temp as $$
  select private.admin_eliminar_catalogo(p_catalogo,p_id);
$$;
revoke all on function public.admin_eliminar_catalogo(text,uuid) from public,anon,authenticated;
grant execute on function public.admin_eliminar_catalogo(text,uuid) to authenticated;

-- Capacidades consultadas en un solo lote. La función de borrado vuelve a verificarlas bajo bloqueo.
create function public.admin_capacidades_catalogo(p_catalogo text,p_ids uuid[])
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
      and not exists(select 1 from public.prendas p where lower(btrim(p.cliente))=lower(btrim(c.nombre)))
      and not exists(select 1 from public.requerimientos r where r.cliente_id=c.id)),'{}')
    into v_result from public.clientes c where c.id=any(p_ids);
  else
    select coalesce(jsonb_object_agg(u.id::text,
      not exists(select 1 from public.requerimientos r where r.unidad_id=u.id)),'{}')
    into v_result from public.unidades u where u.id=any(p_ids);
  end if;
  return v_result;
end $$;
revoke all on function public.admin_capacidades_catalogo(text,uuid[]) from public,anon,authenticated;
grant execute on function public.admin_capacidades_catalogo(text,uuid[]) to authenticated;

notify pgrst,'reload schema';
commit;
