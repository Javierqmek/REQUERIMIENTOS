-- SOLO LECTURA. Ejecutar en Supabase SQL Editor; no modifica ni elimina datos.
-- Criterio: mismo agente, cliente, unidad y coordinador; diferencia máxima de
-- 24 horas; mismo estado o combinación Pendiente/Observado.
with detalle as (
  select d.requerimiento_id,count(*) filter(where d.activo) as prendas,
    coalesce(sum(d.cantidad) filter(where d.activo),0) as unidades,
    coalesce(sum(d.cantidad*d.precio_unitario) filter(where d.activo),0) as total
  from public.detalle_requerimiento d group by d.requerimiento_id
), pares as (
  select a.id as requerimiento_a,b.id as requerimiento_b
  from public.requerimientos a join public.requerimientos b on b.id>a.id
    and b.agente_id=a.agente_id
    and b.cliente_id is not distinct from a.cliente_id
    and b.unidad_id is not distinct from a.unidad_id
    and b.usuario_creador_id=a.usuario_creador_id
    and abs(extract(epoch from (b.created_at-a.created_at)))<=86400
    and (b.estado=a.estado or (b.estado in ('Pendiente','Observado') and a.estado in ('Pendiente','Observado')))
), ids as (
  select requerimiento_a as id,requerimiento_a as grupo from pares
  union all select requerimiento_b,requerimiento_a from pares
), grupos as (
  select id,min(grupo::text)::uuid as grupo_id from ids group by id
)
select g.grupo_id,r.id,r.created_at,r.fecha,p.nombre as agente,c.nombre as cliente,u.nombre as unidad,
  coalesce(pr.nombre,pr.email) as creado_por,r.estado,coalesce(d.prendas,0) as prendas_activas,
  coalesce(d.unidades,0) as unidades_totales,coalesce(d.total,0) as total_monetario
from grupos g join public.requerimientos r on r.id=g.id join public.personal p on p.id=r.agente_id
left join public.clientes c on c.id=r.cliente_id left join public.unidades u on u.id=r.unidad_id
left join public.profiles pr on pr.id=r.usuario_creador_id left join detalle d on d.requerimiento_id=r.id
order by g.grupo_id,r.created_at,r.id;

-- Resumen para conocer cantidad de filas y grupos posiblemente duplicados.
with pares as (
  select a.id a,b.id b from public.requerimientos a join public.requerimientos b on b.id>a.id
    and b.agente_id=a.agente_id and b.cliente_id is not distinct from a.cliente_id
    and b.unidad_id is not distinct from a.unidad_id and b.usuario_creador_id=a.usuario_creador_id
    and abs(extract(epoch from (b.created_at-a.created_at)))<=86400
    and (b.estado=a.estado or (b.estado in ('Pendiente','Observado') and a.estado in ('Pendiente','Observado')))
), ids as (select a id,a grupo from pares union all select b,a from pares),
grupos as (select id,min(grupo::text)::uuid grupo_id from ids group by id)
select count(*) as requerimientos_posiblemente_duplicados,count(distinct grupo_id) as grupos_posibles
from grupos;
