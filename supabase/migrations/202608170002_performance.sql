-- Índices y búsqueda escalable. No modifica RLS ni permisos.
create extension if not exists pg_trgm;

create index if not exists requerimientos_agente_id_idx on public.requerimientos(agente_id);
create index if not exists requerimientos_fecha_idx on public.requerimientos(fecha desc);
create index if not exists requerimientos_estado_fecha_idx on public.requerimientos(estado, fecha desc);
create index if not exists requerimientos_creador_estado_fecha_idx on public.requerimientos(usuario_creador_id, estado, fecha desc);
create index if not exists detalle_prenda_id_idx on public.detalle_requerimiento(prenda_id);
create index if not exists personal_nombre_trgm_idx on public.personal using gin (nombre gin_trgm_ops);
create index if not exists personal_dni_trgm_idx on public.personal using gin (dni gin_trgm_ops);
create index if not exists personal_codigo_trgm_idx on public.personal using gin (codigo_personal gin_trgm_ops);
create index if not exists prendas_cliente_nombre_idx on public.prendas(cliente, nombre_prenda) where activo;

create or replace function public.buscar_personal(p_busqueda text, p_limite integer default 20)
returns setof public.personal
language sql stable security invoker set search_path = public as $$
  select p.*
  from public.personal p
  where p.activo
    and length(trim(p_busqueda)) >= 2
    and (
      p.nombre ilike '%' || trim(p_busqueda) || '%'
      or p.dni ilike '%' || trim(p_busqueda) || '%'
      or p.codigo_personal ilike '%' || trim(p_busqueda) || '%'
    )
  order by
    case when p.codigo_personal = trim(p_busqueda) or p.dni = trim(p_busqueda) then 0 else 1 end,
    similarity(p.nombre, trim(p_busqueda)) desc,
    p.nombre
  limit least(greatest(p_limite, 1), 50);
$$;
revoke all on function public.buscar_personal(text,integer) from public;
grant execute on function public.buscar_personal(text,integer) to authenticated;
