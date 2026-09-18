-- Agrega Provincias al mantenimiento administrativo de catálogos ya existente
-- (admin_guardar_catalogo / admin_actualizar_catalogo_activo / admin_listar_catalogo).
-- No crea un CRUD paralelo. No agrega borrado físico de provincias: solo alta, edición
-- de nombre y baja/alta lógica, igual que se pidió. No modifica clientes/unidades/personal/
-- prendas ni sus políticas; solo amplía la lista de catálogos permitidos en las mismas
-- funciones y reemplaza sus cuerpos completos (CREATE OR REPLACE), como ya se hizo antes
-- con confirmar_firma_documento en 202609140002.
-- Ejecutar después de 202609170001_papeletas_vacaciones.sql.
begin;

alter table private.admin_catalog_audit
  drop constraint if exists admin_catalog_audit_catalogo_check,
  add constraint admin_catalog_audit_catalogo_check
    check (catalogo in ('clientes','unidades','personal','prendas','provincias'));

create or replace function private.admin_guardar_catalogo(p_catalogo text,p_id uuid,p_valores jsonb)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_antes jsonb; v_despues jsonb; v_nombre text; v_codigo text;
  v_cliente_id uuid; v_cliente_nombre text; v_cliente_activo boolean;
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
-- La fachada pública public.admin_guardar_catalogo (INVOKER) ya existe con la misma firma
-- desde 202609130001 y no necesita recrearse: solo reenvía a la función private de arriba.

create or replace function private.admin_actualizar_catalogo_activo(p_catalogo text,p_id uuid,p_activo boolean)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_antes jsonb; v_despues jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_catalogo not in ('clientes','unidades','personal','prendas','provincias') or p_id is null or p_activo is null then
    raise exception 'Datos inválidos' using errcode='22023';
  end if;
  case p_catalogo
    when 'clientes' then select to_jsonb(c.*) into v_antes from public.clientes c where c.id=p_id for update;
    when 'unidades' then select to_jsonb(u.*) into v_antes from public.unidades u where u.id=p_id for update;
    when 'personal' then select to_jsonb(p.*) into v_antes from public.personal p where p.id=p_id for update;
    when 'prendas' then select to_jsonb(p.*) into v_antes from public.prendas p where p.id=p_id for update;
    when 'provincias' then select to_jsonb(p.*) into v_antes from public.provincias p where p.id=p_id for update;
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
  end case;
  insert into private.admin_catalog_audit(usuario_id,accion,catalogo,registro_id,valores_antes,valores_despues)
  values(auth.uid(),case when p_activo then 'ACTIVAR' else 'DESACTIVAR' end,p_catalogo,p_id,v_antes,v_despues);
  return v_despues;
end $$;
revoke all on function private.admin_actualizar_catalogo_activo(text,uuid,boolean) from public,anon,authenticated;
grant execute on function private.admin_actualizar_catalogo_activo(text,uuid,boolean) to authenticated;

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
        select u.id,u.cliente_id,u.nombre,u.activo,jsonb_build_object('nombre',c.nombre) clientes
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
        (p_cliente_id is null or p.cliente=(select c.nombre from public.clientes c where c.id=p_cliente_id))
        and (p_genero is null or p.genero=p_genero) and (v_q='' or
          position(v_q in lower(concat_ws(' ',p.codigo_prenda,p.nombre_prenda,p.codigo_almacen)))>0);
      select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre_prenda,x.id),'[]') into v_rows from (
        select p.id,p.codigo_prenda,p.nombre_prenda,p.codigo_almacen,p.precio,p.cantidad,p.cliente,p.genero,p.activo
        from public.prendas p where
          (p_cliente_id is null or p.cliente=(select c.nombre from public.clientes c where c.id=p_cliente_id))
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

notify pgrst,'reload schema';
commit;
