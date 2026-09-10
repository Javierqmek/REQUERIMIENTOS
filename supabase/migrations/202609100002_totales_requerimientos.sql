-- Totales visuales calculados desde snapshots activos. Ejecutar después de 202609100001.
-- No agrega columnas de datos, no modifica RLS, historial, permisos existentes ni SIDIGE.
begin;

create function public.total_requerimiento_activo(p_requerimiento_id uuid)
returns numeric language sql stable security invoker
set search_path=pg_catalog,public,pg_temp as $$
  select coalesce(sum(d.cantidad*d.precio_unitario),0)::numeric
  from public.detalle_requerimiento d
  where d.requerimiento_id=p_requerimiento_id and d.activo;
$$;
revoke all on function public.total_requerimiento_activo(uuid) from public,anon,authenticated;
grant execute on function public.total_requerimiento_activo(uuid) to authenticated;

create function public.listar_requerimientos_con_total(p_limite integer default 100,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog,public,pg_temp as $$
declare v_rows jsonb;
begin
  if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_limite is null or p_limite<1 or p_limite>100 or p_offset is null or p_offset<0 or p_offset>50000 then
    raise exception 'Paginación inválida' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.fecha desc,x.id desc),'[]'::jsonb) into v_rows
  from (
    select r.id,r.fecha,r.referencia_interna,r.estado,r.usuario_creador_id,r.cliente_id,r.unidad_id,
      case when p.id is not null then jsonb_build_object('nombre',p.nombre,'dni',p.dni,'cargo',p.cargo) end as personal,
      case when c.id is not null then jsonb_build_object('nombre',c.nombre) end as clientes,
      case when u.id is not null then jsonb_build_object('nombre',u.nombre) end as unidades,
      public.total_requerimiento_activo(r.id) as total_requerimiento
    from public.requerimientos r
    left join public.personal p on p.id=r.agente_id
    left join public.clientes c on c.id=r.cliente_id
    left join public.unidades u on u.id=r.unidad_id
    order by r.fecha desc,r.id desc limit p_limite offset p_offset
  ) x;
  return v_rows;
end;
$$;
revoke all on function public.listar_requerimientos_con_total(integer,integer) from public,anon,authenticated;
grant execute on function public.listar_requerimientos_con_total(integer,integer) to authenticated;

create or replace function public.admin_consultar_requerimientos(
  p_cliente_id uuid default null,
  p_unidad_id uuid default null,
  p_coordinador_id uuid default null,
  p_estado public.estado_requerimiento default null,
  p_desde timestamptz default null,
  p_hasta timestamptz default null,
  p_busqueda text default null,
  p_limite integer default 50,
  p_offset integer default 0,
  p_exportar boolean default false,
  p_cursor_fecha timestamptz default null,
  p_cursor_id uuid default null,
  p_creado_hasta timestamptz default null
) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public,pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Solo administradores' using errcode='42501';
  end if;
  if length(p_busqueda)>120 or p_offset>49999950 then
    raise exception 'Filtros demasiado grandes' using errcode='22023';
  end if;
  if p_limite is null or p_limite<1 or p_limite>250 or p_offset is null or p_offset<0 then
    raise exception 'Paginación inválida' using errcode='22023';
  end if;
  if (p_cursor_fecha is null)<>(p_cursor_id is null) then
    raise exception 'Cursor incompleto' using errcode='22023';
  end if;
  if p_desde is not null and p_hasta is not null and p_desde>=p_hasta then
    raise exception 'Rango de fechas inválido' using errcode='22023';
  end if;
  with filtered as not materialized (
    select r.id,r.fecha,r.referencia_interna,r.estado,r.cliente_id,r.unidad_id,r.usuario_creador_id,
      jsonb_build_object('nombre',p.nombre,'dni',p.dni,'cargo',p.cargo) as personal,
      case when c.id is not null then jsonb_build_object('nombre',c.nombre) end as clientes,
      case when u.id is not null then jsonb_build_object('nombre',u.nombre) end as unidades,
      jsonb_build_object('nombre',pr.nombre,'email',pr.email) as profiles
    from public.requerimientos r
    left join public.personal p on p.id=r.agente_id
    left join public.clientes c on c.id=r.cliente_id
    left join public.unidades u on u.id=r.unidad_id
    left join public.profiles pr on pr.id=r.usuario_creador_id
    where (p_cliente_id is null or r.cliente_id=p_cliente_id)
      and (p_unidad_id is null or r.unidad_id=p_unidad_id)
      and (p_coordinador_id is null or r.usuario_creador_id=p_coordinador_id)
      and (p_estado is null or r.estado=p_estado)
      and (p_desde is null or r.fecha>=p_desde)
      and (p_hasta is null or r.fecha<p_hasta)
      and (p_creado_hasta is null or r.created_at<=p_creado_hasta)
      and (nullif(trim(p_busqueda),'') is null or
        position(lower(trim(p_busqueda)) in lower(concat_ws(' ',p.nombre,p.dni,c.nombre,u.nombre,pr.nombre,pr.email)))>0)
  ), page as (
    select * from filtered
    where p_cursor_fecha is null or (fecha,id)<(p_cursor_fecha,p_cursor_id)
    order by fecha desc,id desc limit p_limite offset p_offset
  )
  select jsonb_build_object(
    'total',case when p_exportar then null else (select count(*) from filtered) end,
    'rows',coalesce((select jsonb_agg(
      to_jsonb(r) || jsonb_build_object(
        'cantidad_prendas',coalesce(d.cantidad,0),
        'total_requerimiento',coalesce(d.total_requerimiento,0)
      ) || case when p_exportar then jsonb_build_object('detalle_requerimiento',coalesce(d.detalles,'[]')) else '{}'::jsonb end
      order by r.fecha desc,r.id desc)
      from page r left join lateral (
        select sum(dr.cantidad) as cantidad,
          sum(dr.cantidad*dr.precio_unitario) as total_requerimiento,
          case when p_exportar then jsonb_agg(jsonb_build_object(
            'id',dr.id,'created_at',dr.created_at,'cantidad',dr.cantidad,
            'precio_unitario',dr.precio_unitario,'codigo_almacen',dr.codigo_almacen,
            'prendas',jsonb_build_object('codigo_prenda',g.codigo_prenda,
              'nombre_prenda',g.nombre_prenda,'codigo_almacen',g.codigo_almacen)
          ) order by dr.created_at,dr.id) end as detalles
        from public.detalle_requerimiento dr left join public.prendas g on g.id=dr.prenda_id
        where dr.requerimiento_id=r.id and dr.activo
      ) d on true),'[]')
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.admin_consultar_requerimientos(uuid,uuid,uuid,public.estado_requerimiento,timestamptz,timestamptz,text,integer,integer,boolean,timestamptz,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.admin_consultar_requerimientos(uuid,uuid,uuid,public.estado_requerimiento,timestamptz,timestamptz,text,integer,integer,boolean,timestamptz,uuid,timestamptz) to authenticated;

notify pgrst,'reload schema';
commit;
