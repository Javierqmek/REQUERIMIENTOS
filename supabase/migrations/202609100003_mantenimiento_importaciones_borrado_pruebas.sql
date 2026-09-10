-- Mantenimiento administrativo e importaciones. Ejecutar después de 202609100002.
-- No desactiva RLS ni triggers. El borrado físico está acotado a requerimientos de prueba.
begin;

create table private.app_config (
  clave text primary key,
  habilitado boolean not null,
  updated_at timestamptz not null default now()
);
revoke all on private.app_config from public,anon,authenticated;
insert into private.app_config(clave,habilitado)
values ('allow_test_requirement_deletion',true);

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
    or new.precio_unitario is distinct from old.precio_unitario
    or new.codigo_almacen is distinct from old.codigo_almacen
    or (not new.activo and new.cantidad is distinct from old.cantidad) then
    raise exception 'No se permite alterar los valores históricos de la línea';
  end if;
  return new;
end $$;
revoke all on function public.proteger_historial_detalle() from public,anon,authenticated;

create function private.admin_eliminar_requerimientos_prueba(p_ids uuid[])
returns integer language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_count integer; v_unique integer;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Solo administradores' using errcode='42501';
  end if;
  if not coalesce((select habilitado from private.app_config where clave='allow_test_requirement_deletion'),false) then
    raise exception 'La eliminación de requerimientos de prueba está deshabilitada' using errcode='55000';
  end if;
  if p_ids is null or cardinality(p_ids)<1 or cardinality(p_ids)>100 or array_position(p_ids,null) is not null then
    raise exception 'Selecciona entre 1 y 100 requerimientos' using errcode='22023';
  end if;
  select count(distinct id) into v_unique from unnest(p_ids) id;
  if v_unique<>cardinality(p_ids) then raise exception 'No repitas requerimientos' using errcode='22023'; end if;
  perform r.id from public.requerimientos r where r.id=any(p_ids) order by r.id for update;
  get diagnostics v_count=row_count;
  if v_count<>v_unique then raise exception 'Uno o más requerimientos no existen' using errcode='P0002'; end if;
  perform pg_catalog.set_config('app.test_requirement_deletion','on',true);
  delete from public.detalle_requerimiento where requerimiento_id=any(p_ids);
  delete from public.requerimientos where id=any(p_ids);
  get diagnostics v_count=row_count;
  perform pg_catalog.set_config('app.test_requirement_deletion','off',true);
  return v_count;
end $$;
revoke all on function private.admin_eliminar_requerimientos_prueba(uuid[]) from public,anon,authenticated;
grant execute on function private.admin_eliminar_requerimientos_prueba(uuid[]) to authenticated;
create function public.admin_eliminar_requerimientos_prueba(p_ids uuid[]) returns integer
language sql volatile security invoker set search_path=pg_catalog,pg_temp as $$
  select private.admin_eliminar_requerimientos_prueba(p_ids);
$$;
revoke all on function public.admin_eliminar_requerimientos_prueba(uuid[]) from public,anon,authenticated;
grant execute on function public.admin_eliminar_requerimientos_prueba(uuid[]) to authenticated;

create function private.admin_actualizar_catalogo_activo(p_catalogo text,p_id uuid,p_activo boolean)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_row jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_id is null or p_activo is null then raise exception 'Datos inválidos' using errcode='22023'; end if;
  case p_catalogo
    when 'clientes' then update public.clientes set activo=p_activo where id=p_id returning to_jsonb(clientes.*) into v_row;
    when 'unidades' then update public.unidades set activo=p_activo where id=p_id returning to_jsonb(unidades.*) into v_row;
    when 'personal' then update public.personal set activo=p_activo where id=p_id returning to_jsonb(personal.*) into v_row;
    when 'prendas' then update public.prendas set activo=p_activo where id=p_id returning to_jsonb(prendas.*) into v_row;
    else raise exception 'Catálogo inválido' using errcode='22023';
  end case;
  if v_row is null then raise exception 'Registro no encontrado' using errcode='P0002'; end if;
  return v_row;
end $$;
revoke all on function private.admin_actualizar_catalogo_activo(text,uuid,boolean) from public,anon,authenticated;
grant execute on function private.admin_actualizar_catalogo_activo(text,uuid,boolean) to authenticated;
create function public.admin_actualizar_catalogo_activo(p_catalogo text,p_id uuid,p_activo boolean) returns jsonb
language sql volatile security invoker set search_path=pg_catalog,pg_temp as $$
  select private.admin_actualizar_catalogo_activo(p_catalogo,p_id,p_activo);
$$;
revoke all on function public.admin_actualizar_catalogo_activo(text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.admin_actualizar_catalogo_activo(text,uuid,boolean) to authenticated;

create function public.admin_listar_catalogo(
  p_catalogo text,p_busqueda text default null,p_cliente_id uuid default null,
  p_genero text default null,p_limite integer default 50,p_offset integer default 0
) returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog,public,pg_temp as $$
declare v_rows jsonb; v_total integer; v_q text:=lower(btrim(coalesce(p_busqueda,'')));
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_catalogo not in ('clientes','unidades','personal','prendas') or length(v_q)>120
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
  end case;
  return jsonb_build_object('rows',v_rows,'total',v_total);
end $$;
revoke all on function public.admin_listar_catalogo(text,text,uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.admin_listar_catalogo(text,text,uuid,text,integer,integer) to authenticated;

create function private.admin_importar_catalogo(p_catalogo text,p_filas jsonb)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v jsonb; v_new integer:=0; v_updated integer:=0; v_exists boolean;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_catalogo not in ('personal','prendas') or p_filas is null or jsonb_typeof(p_filas)<>'array'
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
    else
      if jsonb_typeof(v)<>'object' or (v-'codigo_prenda'-'nombre_prenda'-'codigo_almacen'-'precio'-'cantidad'-'cliente'-'genero'-'activo')<>'{}'::jsonb
        or nullif(btrim(v->>'codigo_prenda'),'') is null or length(btrim(v->>'codigo_prenda'))>80
        or nullif(btrim(v->>'nombre_prenda'),'') is null or length(btrim(v->>'nombre_prenda'))>240
        or nullif(btrim(v->>'codigo_almacen'),'') is null or length(btrim(v->>'codigo_almacen'))>80
        or (v->>'precio')!~'^[0-9]+([.][0-9]{1,2})?$' or (v->>'precio')::numeric<0
        or (v->>'cantidad')!~'^[1-9][0-9]*$' or (v->>'cantidad')::integer>10000
        or v->>'genero' not in ('HOMBRE','MUJER','AMBOS') or jsonb_typeof(v->'activo')<>'boolean'
        or not exists(select 1 from public.clientes where nombre=btrim(v->>'cliente')) then
        raise exception 'Fila de prenda inválida' using errcode='22023';
      end if;
      select exists(select 1 from public.prendas where codigo_prenda=btrim(v->>'codigo_prenda')) into v_exists;
      insert into public.prendas(codigo_prenda,nombre_prenda,codigo_almacen,precio,cantidad,cliente,genero,activo)
      values(btrim(v->>'codigo_prenda'),btrim(v->>'nombre_prenda'),btrim(v->>'codigo_almacen'),(v->>'precio')::numeric,
        (v->>'cantidad')::integer,btrim(v->>'cliente'),v->>'genero',(v->>'activo')::boolean)
      on conflict(codigo_prenda) do update set nombre_prenda=excluded.nombre_prenda,codigo_almacen=excluded.codigo_almacen,
        precio=excluded.precio,cantidad=excluded.cantidad,cliente=excluded.cliente,genero=excluded.genero,activo=excluded.activo;
    end if;
    if v_exists then v_updated:=v_updated+1; else v_new:=v_new+1; end if;
  end loop;
  return jsonb_build_object('nuevos',v_new,'actualizados',v_updated,'omitidos',0,'errores',0);
end $$;
revoke all on function private.admin_importar_catalogo(text,jsonb) from public,anon,authenticated;
grant execute on function private.admin_importar_catalogo(text,jsonb) to authenticated;
create function public.admin_importar_catalogo(p_catalogo text,p_filas jsonb) returns jsonb
language sql volatile security invoker set search_path=pg_catalog,pg_temp as $$
  select private.admin_importar_catalogo(p_catalogo,p_filas);
$$;
revoke all on function public.admin_importar_catalogo(text,jsonb) from public,anon,authenticated;
grant execute on function public.admin_importar_catalogo(text,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
