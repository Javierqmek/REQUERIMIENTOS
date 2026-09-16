-- Idempotencia de creación, conteos coherentes y diagnóstico administrativo.
-- No elimina ni modifica requerimientos existentes. Aplicar después de 202609140002.
begin;

alter table public.requerimientos add column request_id uuid;
create unique index requerimientos_creador_request_id_unique
  on public.requerimientos(usuario_creador_id,request_id) where request_id is not null;
create index requerimientos_posibles_duplicados_idx
  on public.requerimientos(agente_id,cliente_id,unidad_id,usuario_creador_id,fecha);

comment on column public.requerimientos.request_id is
  'Clave idempotente generada por el formulario. Un reintento de la misma creación devuelve la cabecera existente.';

create function public.crear_requerimiento(
  p_agente_id uuid,p_cliente_id uuid,p_unidad_id uuid,p_detalles jsonb,p_request_id uuid
) returns uuid language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null or p_request_id is null then
    raise exception 'Solicitud no autorizada o incompleta' using errcode='42501';
  end if;
  -- Serializa únicamente reintentos de la misma solicitud del mismo usuario.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text || ':' || p_request_id::text,0));
  select r.id into v_id from public.requerimientos r
    where r.usuario_creador_id=auth.uid() and r.request_id=p_request_id;
  if found then return v_id; end if;
  v_id:=public.crear_requerimiento(p_agente_id,p_cliente_id,p_unidad_id,p_detalles);
  update public.requerimientos set request_id=p_request_id where id=v_id;
  return v_id;
end $$;
revoke all on function public.crear_requerimiento(uuid,uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.crear_requerimiento(uuid,uuid,uuid,jsonb,uuid) to authenticated;

create or replace function public.listar_requerimientos_con_total(p_limite integer default 100,p_offset integer default 0)
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
      coalesce(d.cantidad_prendas,0) as cantidad_prendas,
      coalesce(d.unidades_totales,0) as unidades_totales,
      coalesce(d.total_requerimiento,0) as total_requerimiento
    from public.requerimientos r
    left join public.personal p on p.id=r.agente_id
    left join public.clientes c on c.id=r.cliente_id
    left join public.unidades u on u.id=r.unidad_id
    left join lateral (
      select count(*)::integer as cantidad_prendas,
        coalesce(sum(dr.cantidad),0)::integer as unidades_totales,
        coalesce(sum(dr.cantidad*dr.precio_unitario),0)::numeric as total_requerimiento
      from public.detalle_requerimiento dr where dr.requerimiento_id=r.id and dr.activo
    ) d on true
    order by r.fecha desc,r.id desc limit p_limite offset p_offset
  ) x;
  return v_rows;
end $$;
revoke all on function public.listar_requerimientos_con_total(integer,integer) from public,anon,authenticated;
grant execute on function public.listar_requerimientos_con_total(integer,integer) to authenticated;

create function public.admin_consultar_requerimientos_v2(
  p_cliente_id uuid default null,p_unidad_id uuid default null,p_coordinador_id uuid default null,
  p_estado public.estado_requerimiento default null,p_desde timestamptz default null,p_hasta timestamptz default null,
  p_busqueda text default null,p_solo_duplicados boolean default false,p_orden text default 'fecha',
  p_direccion text default 'desc',p_limite integer default 50,p_offset integer default 0,
  p_exportar boolean default false,p_cursor_fecha timestamptz default null,p_cursor_id uuid default null,
  p_creado_hasta timestamptz default null
) returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog,public,pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_orden not in ('fecha','agente','cliente','unidad','coordinador','estado','prendas','total')
    or p_direccion not in ('asc','desc') then raise exception 'Orden inválido' using errcode='22023'; end if;
  if length(p_busqueda)>120 or p_limite is null or p_limite<1 or p_limite>250
    or p_offset is null or p_offset<0 or p_offset>49999950 then raise exception 'Paginación inválida' using errcode='22023'; end if;
  if (p_cursor_fecha is null)<>(p_cursor_id is null) then raise exception 'Cursor incompleto' using errcode='22023'; end if;
  if p_desde is not null and p_hasta is not null and p_desde>=p_hasta then raise exception 'Rango inválido' using errcode='22023'; end if;

  with all_rows as materialized (
    select r.id,r.fecha,r.created_at,r.referencia_interna,r.estado,r.agente_id,r.cliente_id,r.unidad_id,r.usuario_creador_id,
      jsonb_build_object('nombre',p.nombre,'dni',p.dni,'cargo',p.cargo) as personal,
      case when c.id is not null then jsonb_build_object('nombre',c.nombre) end as clientes,
      case when u.id is not null then jsonb_build_object('nombre',u.nombre) end as unidades,
      jsonb_build_object('nombre',pr.nombre,'email',pr.email) as profiles,
      lower(coalesce(p.nombre,'')) as agente_orden,lower(coalesce(c.nombre,'')) as cliente_orden,
      lower(coalesce(u.nombre,'')) as unidad_orden,lower(coalesce(pr.nombre,pr.email,'')) as coordinador_orden,
      coalesce(d.cantidad_prendas,0) as cantidad_prendas,coalesce(d.unidades_totales,0) as unidades_totales,
      coalesce(d.total_requerimiento,0) as total_requerimiento
    from public.requerimientos r
    left join public.personal p on p.id=r.agente_id left join public.clientes c on c.id=r.cliente_id
    left join public.unidades u on u.id=r.unidad_id left join public.profiles pr on pr.id=r.usuario_creador_id
    left join lateral (
      select count(*)::integer cantidad_prendas,coalesce(sum(dr.cantidad),0)::integer unidades_totales,
        coalesce(sum(dr.cantidad*dr.precio_unitario),0)::numeric total_requerimiento
      from public.detalle_requerimiento dr where dr.requerimiento_id=r.id and dr.activo
    ) d on true
  ), annotated as (
    select a.*,m.grupo_duplicado_id,m.coincidencias+1 as grupo_duplicado_tamano,
      m.coincidencias>0 as posible_duplicado,
      m.coincidencias>0 and a.cantidad_prendas<m.max_prendas as potencialmente_incompleto
    from all_rows a left join lateral (
      select least(a.id::text,min(b.id::text))::uuid as grupo_duplicado_id,count(*)::integer coincidencias,
        greatest(a.cantidad_prendas,max(b.cantidad_prendas))::integer max_prendas
      from all_rows b where b.id<>a.id and b.agente_id=a.agente_id
        and b.cliente_id is not distinct from a.cliente_id and b.unidad_id is not distinct from a.unidad_id
        and b.usuario_creador_id=a.usuario_creador_id
        and abs(extract(epoch from (b.created_at-a.created_at)))<=86400
        and (b.estado=a.estado or (b.estado in ('Pendiente','Observado') and a.estado in ('Pendiente','Observado')))
    ) m on true
  ), scoped as (
    select * from annotated a where (p_cliente_id is null or a.cliente_id=p_cliente_id)
      and (p_unidad_id is null or a.unidad_id=p_unidad_id) and (p_coordinador_id is null or a.usuario_creador_id=p_coordinador_id)
      and (p_estado is null or a.estado=p_estado) and (p_desde is null or a.fecha>=p_desde)
      and (p_hasta is null or a.fecha<p_hasta) and (p_creado_hasta is null or a.created_at<=p_creado_hasta)
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
      case when p_orden='total' and p_direccion='asc' then total_requerimiento end asc,case when p_orden='total' and p_direccion='desc' then total_requerimiento end desc,id) as posicion
    from filtered f where p_cursor_fecha is null or (fecha,id)<(p_cursor_fecha,p_cursor_id)
  ), page as (select * from ranked order by posicion limit p_limite offset p_offset)
  select jsonb_build_object(
    'total',case when p_exportar then null else (select count(*) from filtered) end,
    'duplicate_total',(select count(*) from scoped where posible_duplicado),
    'duplicate_groups',(select count(distinct grupo_duplicado_id) from scoped where posible_duplicado),
    'rows',coalesce((select jsonb_agg((to_jsonb(r)-'agente_orden'-'cliente_orden'-'unidad_orden'-'coordinador_orden'-'posicion') ||
      case when p_exportar then jsonb_build_object('detalle_requerimiento',coalesce(d.detalles,'[]')) else '{}'::jsonb end order by r.posicion)
      from page r left join lateral (
        select jsonb_agg(jsonb_build_object('id',dr.id,'created_at',dr.created_at,'cantidad',dr.cantidad,
          'precio_unitario',dr.precio_unitario,'codigo_almacen',dr.codigo_almacen,
          'prendas',jsonb_build_object('codigo_prenda',g.codigo_prenda,'nombre_prenda',g.nombre_prenda,'codigo_almacen',g.codigo_almacen))
          order by dr.created_at,dr.id) as detalles
        from public.detalle_requerimiento dr left join public.prendas g on g.id=dr.prenda_id
        where dr.requerimiento_id=r.id and dr.activo
      ) d on true),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.admin_consultar_requerimientos_v2(uuid,uuid,uuid,public.estado_requerimiento,timestamptz,timestamptz,text,boolean,text,text,integer,integer,boolean,timestamptz,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.admin_consultar_requerimientos_v2(uuid,uuid,uuid,public.estado_requerimiento,timestamptz,timestamptz,text,boolean,text,text,integer,integer,boolean,timestamptz,uuid,timestamptz) to authenticated;

notify pgrst,'reload schema';
commit;
