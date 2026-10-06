-- Recuperar las prendas de un cliente (RENIEC) que pasaron a otro (INDECOPI) por el upsert por codigo_prenda.
-- SOLO LECTURA hasta el bloque final (comentado). Ejecutar en el SQL Editor y revisar antes de aplicar nada.
--
-- ¿Existe historial de los valores anteriores? NO en la importación: admin_importar_catalogo nunca escribió en
-- private.admin_catalog_audit (solo las ediciones manuales de Mantenimiento quedan ahí). Fuentes que sí sirven:
--   1. los requerimientos ya registrados del cliente (cada línea conserva prenda, cantidad y precio);
--   2. la auditoría de ediciones manuales (consulta B);
--   3. un respaldo / "point in time recovery" de Supabase, si el plan lo incluye (la fuente más completa);
--   4. reimportar el archivo de RENIEC con el modelo nuevo (la opción más simple y la que recomiendo).
-- Para otro cliente, reemplace 'RENIEC' (aparece en cada consulta) por su nombre exacto.

-- A. Prendas que el cliente pidió alguna vez (requerimientos activos o no), con la renovación y la última cantidad.
with lineas as (
  select p.id as prenda_id,p.codigo_prenda,p.nombre_prenda,r.renovacion,d.cantidad,d.created_at,
    row_number() over(partition by p.id,r.renovacion order by d.created_at desc,d.id desc) as n
  from public.requerimientos r
  join public.clientes c on c.id=r.cliente_id and lower(btrim(c.nombre))=lower(btrim('RENIEC'))
  join public.detalle_requerimiento d on d.requerimiento_id=r.id
  join public.prendas p on p.id=d.prenda_id)
select codigo_prenda,nombre_prenda,renovacion,cantidad as ultima_cantidad,created_at as ultima_vez
from lineas where n=1 order by codigo_prenda,renovacion;

-- B. Ediciones manuales de prendas auditadas que mencionan al cliente (valores_antes / valores_despues).
select a.created_at,a.accion,a.registro_id,a.valores_antes,a.valores_despues
from private.admin_catalog_audit a
where a.catalogo='prendas' and (a.valores_antes::text ilike '%'||'RENIEC'||'%' or a.valores_despues::text ilike '%'||'RENIEC'||'%')
order by a.created_at;

-- C. Respaldo automático de la migración 202610060001 (lo que había antes de separar fichas y asignaciones).
-- Solo existe si esa migración ya se aplicó.
select to_regclass('private.prendas_asignacion_respaldo') is not null as hay_respaldo_de_la_migracion;

-- D. Asignaciones actuales del cliente (para comparar). Solo con el modelo nuevo (después de 202610060001).
-- select p.codigo_prenda,a.renovacion,a.cantidad,a.activo from public.prenda_clientes a
--   join public.prendas p on p.id=a.prenda_id join public.clientes c on c.id=a.cliente_id
--  where lower(btrim(c.nombre))=lower(btrim('RENIEC')) order by 1,2;

-- E. PROPUESTA de restauración (NO ejecutar sin revisar A). Solo para el modelo nuevo y solo para prendas que el
-- cliente ya pidió: crea la asignación con la renovación del requerimiento y la última cantidad usada, y no toca
-- ninguna asignación existente. Prendas que el cliente nunca pidió no se pueden deducir de los datos.
-- begin;
-- insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,cantidad)
-- select x.prenda_id,x.cliente_id,x.renovacion,x.cantidad from (
--   select d.prenda_id,r.cliente_id,r.renovacion,d.cantidad,
--     row_number() over(partition by d.prenda_id,r.renovacion order by d.created_at desc,d.id desc) as n
--   from public.requerimientos r
--   join public.clientes c on c.id=r.cliente_id and lower(btrim(c.nombre))=lower(btrim('RENIEC'))
--   join public.detalle_requerimiento d on d.requerimiento_id=r.id) x
-- where x.n=1 and not exists(select 1 from public.prenda_clientes a where a.prenda_id=x.prenda_id and a.cliente_id=x.cliente_id);
-- -- revisar el resultado con la consulta D y recién entonces: commit;  (o rollback;)
