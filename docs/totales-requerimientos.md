# Totales de requerimientos

## Alcance

La interfaz oculta `codigo_prenda` únicamente en las opciones de los selectores de creación y edición. El código continúa en el modelo, las consultas, los detalles históricos y las exportaciones. El filtro por género y la búsqueda del selector no cambian.

En creación y edición, cada línea muestra cantidad fija, precio unitario y subtotal. El resumen compacto se recalcula de inmediato al agregar, retirar, sustituir o descartar prendas incompatibles al cambiar el género. Ni precio ni cantidad son editables.

## Regla de cálculo

- Requerimiento nuevo: `prendas.precio × prendas.cantidad`.
- Requerimiento guardado: `detalle_requerimiento.precio_unitario × detalle_requerimiento.cantidad`.
- Solo se suman líneas con `activo = true`; una línea retirada conserva su snapshot, pero no aparece ni suma.
- El formato visual es `S/ 0.00`.

Mis requerimientos y Administración reciben el total desde PostgreSQL; el navegador no descarga tablas de detalle completas. RLS sigue determinando las filas visibles. La consulta de Administración mantiene su validación exclusiva para admin.

## Migración que debes ejecutar

No se ejecutó SQL en Supabase remoto durante esta implementación. En un proyecto que ya tiene las migraciones anteriores, abre **SQL Editor**, pega y ejecuta una sola vez el contenido completo de:

`supabase/migrations/202609100002_totales_requerimientos.sql`

Debe ejecutarse después de `202609100001_prendas_genero.sql` y antes de desplegar este frontend. La migración es transaccional y:

- crea un cálculo `SECURITY INVOKER` limitado a usuarios autenticados;
- crea el listado paginado de requerimientos con total, respetando RLS;
- amplía la respuesta administrativa con el total histórico activo;
- no crea columnas, no modifica filas y no cambia políticas RLS, roles ni permisos de tablas.

No ejecutes `supabase/tests/totales-requerimientos.sql` en producción: es una prueba con fixtures temporales diseñada para una base descartable.

## SIDIGE

El generador Excel no fue modificado. La exportación SIDIGE conserva exactamente las mismas diez columnas y no incluye total. La fuente administrativa sigue omitiendo las líneas retiradas.

## Validación local

La migración se reconstruyó junto con todas las anteriores en PostgreSQL 18 aislado. La regresión SQL completa confirmó RLS, roles, baja lógica, snapshots históricos, género y contrato SIDIGE. La prueba específica comprueba un total de `S/ 101.00` formado por líneas activas de `2 × 28` y `1 × 45`, ignorando una línea inactiva y precios actuales distintos en el maestro.
