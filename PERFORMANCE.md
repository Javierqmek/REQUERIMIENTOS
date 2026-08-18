# Revisión de rendimiento

## Problemas encontrados

1. El panel administrativo solicitaba la tabla completa de requerimientos y todo el detalle de prendas en una sola carga, aunque la tabla solo mostraba la cabecera.
2. “Mis requerimientos” no tenía límite y transfería todo el historial al cliente.
3. La búsqueda de agentes ejecutaba tres `ILIKE '%texto%'` sin índices compatibles. Una respuesta anterior podía llegar después de una búsqueda nueva.
4. Al regresar y seleccionar otro agente del mismo cliente se repetía la consulta de prendas.
5. El layout privado y la página administrativa repetían la consulta de sesión y perfil durante el mismo render.
6. Faltaban índices independientes o compuestos para varios filtros y relaciones usados por las consultas.
7. La exportación dependía de todos los detalles ya cargados en el navegador.

## Cambios aplicados

- El perfil autenticado se obtiene mediante una función memoizada con `cache()`, compartida por layouts y páginas Server Component durante el mismo render.
- El panel administrativo obtiene 50 cabeceras inicialmente, sin detalles, y permite cargar bloques adicionales.
- “Mis requerimientos” obtiene 100 registros inicialmente y permite cargar los siguientes bloques.
- La exportación se movió a una ruta de servidor exclusiva para administradores. Lee lotes de 500 y genera el CSV sin llenar el estado del componente con toda la tabla.
- La búsqueda de agentes usa una función PostgreSQL con límite máximo de 50, devuelve 20 desde la interfaz y conserva RLS mediante `security invoker`.
- Cada búsqueda cancela la petición anterior con `AbortController`, evitando trabajo y resultados obsoletos.
- Las prendas seleccionan únicamente columnas utilizadas, tienen límite y se mantienen en caché por cliente durante el formulario.
- Se conservaron como Server Components las páginas que hacen la carga inicial; únicamente búsqueda, filtros, paginación, edición de estado y formulario permanecen como Client Components.
- El detalle sigue siendo una única consulta con relaciones embebidas, evitando un waterfall de cabecera → agente → prendas.

## Índices agregados

La migración `supabase/migrations/202608170002_performance.sql` agrega o complementa índices para:

- `requerimientos.usuario_creador_id` junto con estado y fecha;
- `requerimientos.agente_id`;
- `requerimientos.fecha` descendente;
- `requerimientos.estado` junto con fecha;
- `detalle_requerimiento.requerimiento_id` (ya existía en la migración inicial);
- `detalle_requerimiento.prenda_id`;
- nombre, DNI y código de personal mediante GIN trigram;
- cliente y nombre de prenda para el catálogo activo.

## Consultas paralelas

No quedaron consultas independientes en una misma pantalla que justifiquen `Promise.all`. La lectura del perfil depende primero del usuario autenticado, y la autorización administrativa debe resolverse antes de consultar datos protegidos. Forzar paralelismo allí duplicaría clientes o consultaría información que quizá el usuario no puede abrir. Las relaciones de detalle se resuelven en una sola consulta Supabase.

## Activación

En un proyecto Supabase existente se debe ejecutar una sola vez `supabase/migrations/202608170002_performance.sql` desde SQL Editor. La migración no desactiva ni modifica políticas RLS.

## Verificación

- ESLint: aprobado sin advertencias.
- TypeScript: aprobado.
- Build de producción Next.js: aprobado.
