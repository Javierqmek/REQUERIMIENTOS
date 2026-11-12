-- SOLO LECTURA. Prendas que hoy no tienen ninguna asignación (aparecen como "Sin asignar" en Mantenimiento → Prendas) y cómo se crearon.
select p.codigo_prenda, p.nombre_prenda, p.codigo_almacen, p.activo, p.created_at,
       (select a.accion || ' · ' || a.created_at::text from private.admin_catalog_audit a
         where a.catalogo = 'prendas' and a.registro_id = p.id order by a.created_at limit 1) as primera_auditoria,
       (select count(*) from private.admin_catalog_audit a where a.catalogo = 'prendas' and a.registro_id = p.id) as movimientos_auditados
from public.prendas p
where not exists (select 1 from public.prenda_clientes a where a.prenda_id = p.id)
order by p.created_at desc;

-- Historial completo de una prenda concreta (p. ej. 11AS001): con qué asignaciones se guardó la ficha al crearla y qué cambió después.
select a.created_at, a.accion, a.valores_antes -> 'asignaciones' as asignaciones_antes, a.valores_despues -> 'asignaciones' as asignaciones_despues
from private.admin_catalog_audit a
join public.prendas p on p.id = a.registro_id
where a.catalogo = 'prendas' and p.codigo_prenda = '11AS001'
order by a.created_at;
