# Roles, edición de prendas y baja lógica

## Qué ejecutar en Supabase

No se aplicó ninguna migración al Supabase remoto. Los cambios requieren desplegar SQL y aplicación de forma coordinada; la aplicación nueva reconoce únicamente `admin` y `coordinador`.

Si ya aplicaste las primeras cuatro migraciones, abre SQL Editor y ejecuta **el contenido completo** de estos archivos, cada uno en una consulta nueva y en este orden:

1. `supabase/migrations/202609020003_rol_coordinador.sql`.
2. `supabase/migrations/202609020004_detalle_baja_logica_edicion.sql`.

No pegues solo los nombres: copia todo el SQL, incluidos `begin` y `commit`. Registra qué migraciones aplicaste. No vuelvas a ejecutar archivos ya aplicados, no ejecutes seed ni scripts de pruebas en producción. Si utilizas Supabase CLI, aplica mediante tu flujo habitual de migraciones pendientes, manteniendo el mismo orden.

Para una instalación nueva, antes van `202608170001_initial_schema.sql`, `202608170002_performance.sql`, `202609020001_clientes_unidades_cantidad.sql` y `202609020002_admin_sidige.sql`. Ninguna migración antigua fue modificada.

Recomendación de despliegue: respaldo habitual, breve ventana sin ediciones, ejecutar ambas migraciones, desplegar/reiniciar esta versión y recargar los navegadores. No desplegar este frontend antes del SQL. El enum se renombra conservando su identidad: los perfiles existentes y el default pasan a coordinador sin borrar/recrear usuarios ni reescribir sus datos. Las referencias al nombre antiguo solo permanecen en la migración original y en la instrucción de conversión.

## Cambios de esquema

No hay tablas nuevas en esta entrega. `detalle_requerimiento` recibe:

| Columna | Uso |
| --- | --- |
| `activo boolean not null default true` | Todos los detalles existentes continúan activos. |
| `retirado_at timestamptz` | Momento de retiro. |
| `retirado_por uuid references profiles(id)` | Usuario que retiró la línea. |

Un check mantiene consistente el estado y los metadatos de retiro. Se sustituye la restricción unique global `(requerimiento_id, prenda_id)` por un índice unique parcial para `activo = true`. Permite varias versiones históricas, pero una sola línea activa de cada prenda. No se elimina ningún registro al cambiar esta restricción.

Un trigger impide borrar físicamente líneas, alterar sus identificadores/precio/código y modificar o reactivar las retiradas. Al retirar una línea se conserva también su cantidad anterior. Esto impide asimismo que una eliminación en cascada de un requerimiento destruya detalles: cualquier futura purga exige una decisión explícita fuera de esta aplicación.

No cambia el orden de importación de catálogos: clientes → unidades → personal → prendas. No es necesario reimportar usuarios, requerimientos ni detalles; no incluir columnas de retiro en importaciones operativas.

## Seguridad y lectura del historial

RLS continúa habilitada en todas las tablas y se conservan sus políticas existentes. La nueva política **restrictiva** `detalle_operativo_activo` añade `activo` a la lectura de usuarios autenticados, incluidos administradores. Por ello detalle normal, Mis requerimientos, consultas administrativas, sumatorias y las fuentes de CSV/SIDIGE solo reciben líneas activas. El detalle agrega además filtro explícito; los generadores CSV y Excel descartan defensivamente cualquier línea marcada inactiva.

Las funciones administrativas siguen siendo `SECURITY INVOKER`: sus agregaciones respetan esta nueva restricción. No se cambia el contrato SIDIGE ni sus diez columnas, filtros o paginación. No debe cambiarse el servidor de aplicación a `service_role`, pues esa credencial omite RLS.

El historial no tiene una ruta pública/operativa. Un operador autorizado de la base puede inspeccionarlo en SQL Editor con una consulta acotada:

```sql
select id, requerimiento_id, prenda_id, cantidad, precio_unitario,
       codigo_almacen, created_at, retirado_at, retirado_por
from public.detalle_requerimiento
where requerimiento_id = 'REEMPLAZAR_POR_UUID'::uuid
  and not activo
order by retirado_at, id;
```

No se conceden INSERT/UPDATE/DELETE/TRUNCATE directos sobre detalles a `authenticated`, `anon` o PUBLIC. La edición usa una RPC atómica `editar_prendas_requerimiento(uuid,text,jsonb)`, con la misma frontera `SECURITY DEFINER` que el guardado existente: sin acceso anónimo, `search_path` fijo, objetos calificados y comprobación explícita de `auth.uid()`, perfil, rol, propietario y estado. `obtener_edicion_prendas(uuid)` devuelve únicamente el requerimiento autorizado y sus líneas activas; permite leer el maestro de una prenda conservada aunque haya sido desactivada.

## Reglas de edición

| Acción | Coordinador | Admin |
| --- | --- | --- |
| Crear requerimiento | Sí | Sí, flujo existente |
| Ver y editar prendas | Solo propias | Cualquier requerimiento |
| Administrar, filtrar y exportar | No | Sí |
| Cambiar estado | No | Sí |
| Modificar cabecera, agente, DNI, cargo o destino | No | No |
| Editar prendas en Pendiente/Observado | Sí, propias | Sí |
| Editar prendas en Atendido | No | No |

El bloqueo muestra “Este requerimiento ya fue atendido y no puede modificarse.” No se implementó ninguna excepción admin. Una alternativa futura sería un flujo auditado de reapertura explícita; no es parte de esta entrega. El admin conserva el control de estado que ya existía.

La API `PATCH /api/requerimientos/[id]/prendas` acepta exclusivamente una versión y un arreglo de `{prenda_id, detalle_id?}`. Rechaza cabecera, estado, cantidades, precios o códigos enviados por el navegador. La RPC repite las validaciones para impedir que se omita la API de Next.js.

- Línea conservada: envía `detalle_id`; mantiene ID, precio y código históricos, tomando automáticamente la cantidad actual de `prendas.cantidad` al guardar. Puede conservarse aunque el maestro esté inactivo.
- Línea retirada: se marca inactiva con fecha/autor; no se cambia su cantidad, precio ni código.
- Línea nueva o retirada y agregada otra vez, incluso dentro de la misma edición: no envía `detalle_id`; crea un UUID nuevo y toma cantidad/precio/código actuales. Debe estar activa y pertenecer al cliente original del requerimiento.
- No se acepta usar el `detalle_id` de una línea retirada ni de otro requerimiento, ni duplicados, ni un conjunto vacío. Límite de seguridad: 500 prendas por guardado.
- Requerimientos históricos sin cliente: pueden conservar/retirar líneas dejando al menos una, pero no agregar; no se infiere ni modifica la cabecera.

El guardado bloquea la cabecera para serializarse con cambios de estado y bloquea los maestros usados mientras copia sus valores. Una huella de las líneas activas y sus maestros detecta ediciones obsoletas: devuelve conflicto y pide recargar, conservando la selección visible sin sobrescribir silenciosamente los cambios de otro usuario. Una sustitución o retiro fallidos revierten toda la transacción.

## UI y auditoría visual

La pantalla anterior solo tenía detalle y no distinguía edición de prendas. Se añadió una acción secundaria “Editar prendas”, visible solo cuando corresponde. La nueva ruta termina en `/requerimientos/[id]/editar`; las rutas existentes se conservan.

Aplicando corporate-product-ui se reutilizaron header, paleta, tipografía, botones, alertas, badge y estado de carga. `RequirementFacts` centraliza los datos de solo lectura para detalle y edición: rejilla compacta, sin inputs falsamente editables. El selector presenta prenda + cantidad fija + Agregar; las líneas son filas, no cards anidadas. Guardar/Cancelar quedan en el pie de formulario, ancho completo en móvil y contenido en desktop. Guardado bloquea doble submit, muestra spinner y “Guardando cambios...”; éxito permanece en pantalla con acceso al detalle. Error de red permite reintentar; conflicto ofrece recarga y bloquea un nuevo guardado obsoleto.

El alcance de backend se limita a los cambios de roles y edición autorizados. El flujo agente → cliente → unidad → prendas, administración, permisos de estado y exportación SIDIGE se conserva.

## Validación

Ejecutar desde la raíz:

```bash
npm run lint
npm run typecheck
npm run build
npm test
npm run test:ui
```

En Windows sin Chromium descargado se puede usar Edge en una instancia de pruebas independiente:

```powershell
$env:PLAYWRIGHT_CHANNEL='msedge'
npm run test:ui
```

Pruebas SQL, **solo en una base descartable** con las seis migraciones y esquema Auth de pruebas: `supabase/tests/clientes-unidades.sql`, `supabase/tests/admin-sidige.sql` y `supabase/tests/edicion-prendas.sql`. Cada archivo hace BEGIN/ROLLBACK. No ejecutar contra Supabase remoto productivo.

Se validan propietario/ajeno, acceso anónimo, admin, estado, rechazo de cabecera y valores manuales, conservación de snapshots, retiros/reagregados, duplicados, mínimo una prenda, inmutabilidad del historial, lecturas RLS, conteos y exportaciones, conflictos y rollback. Las pruebas visuales usan los componentes reales con APIs/catálogos ficticios, no sesiones reales de Supabase, a 1440×900, 1366×768, 390×844, 375×812 y 320×700. Capturas locales en `.qa/edit-*.png`.

Resultado local: lint, typecheck y build correctos; 70 pruebas unitarias/API/exportación y 22 pruebas visuales aprobadas; tres scripts SQL aprobados en PostgreSQL 18 aislado. Se verificó que el renombrado del enum y la baja lógica conservaron los perfiles y detalles preexistentes. La validación visual utilizó Edge aislado porque el navegador integrado falló al iniciar por permisos ACL de Windows. No equivale a una prueba de sesión real contra tu Supabase: esa comprobación queda para después de que apliques las migraciones remotas.
