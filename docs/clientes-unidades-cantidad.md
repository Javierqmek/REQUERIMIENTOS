# Clientes, unidades y cantidades fijas

## Estado y alcance

Migración nueva: `supabase/migrations/202609020001_clientes_unidades_cantidad.sql`.
Las migraciones anteriores no se modifican. Ningún dato existente se elimina.
Este cambio se probó en PostgreSQL 18 temporal, no se aplicó al Supabase remoto.

## Cambios del modelo

| Tabla | Cambio |
| --- | --- |
| `clientes` | Nueva: `id`, `nombre` único, `activo`, `created_at`. |
| `unidades` | Nueva: `id`, `cliente_id`, `nombre`, `activo`, `created_at`. Única por cliente y nombre. |
| `personal` | El flujo utiliza `id,codigo_personal,nombre,dni,cargo,activo,created_at`. `cliente` y `unidad` quedan como columnas legadas opcionales, con todos sus valores conservados; no se consultan desde la aplicación. |
| `prendas` | Nueva `cantidad integer not null default 1`, con CHECK positivo. Se conserva `cliente` textual. |
| `requerimientos` | Nuevas `cliente_id` y `unidad_id`, con claves foráneas. Una FK compuesta también garantiza que la unidad pertenezca al cliente. |
| `detalle_requerimiento` | Sin cambios de esquema: conserva `prenda_id`, `cantidad`, `precio_unitario`, `codigo_almacen` y su historial. |

No se cambian rutas, autenticación, roles ni los estados existentes.

## Compatibilidad del historial

- La migración crea clientes a partir de nombres no vacíos de `personal.cliente` y `prendas.cliente`, sin renombrarlos ni normalizarlos.
- Crea unidades a partir de los pares cliente/unidad no vacíos de personal.
- Completa solo las columnas nuevas de requerimientos antiguos con el destino disponible en personal al migrar.
- Esto no reconstruye movimientos anteriores del agente: antes no había un destino almacenado por requerimiento. Conviene revisar el resultado con el responsable de los datos.
- Si no había destino conocido, mantiene NULL. La UI y el CSV muestran “Sin cliente (histórico)” / “Sin unidad (histórico)”, sin inventar asignaciones.
- Los detalles antiguos no se recalculan: sus cantidades, precios y códigos permanecen intactos.
- Todas las prendas existentes reciben cantidad inicial 1. Revisa el maestro y define las cantidades operativas antes de reabrir la creación de solicitudes.

La firma RPC antigua `crear_requerimiento(uuid,jsonb)` se conserva, pero devuelve un mensaje pidiendo actualizar la aplicación. No es seguro permitirle crear solicitudes sin destino explícito ni aceptar cantidades antiguas editables. El despliegue requiere una ventana coordinada y recargar las pestañas abiertas.

## SQL que debes ejecutar en Supabase

1. Genera un respaldo y ensaya primero en un proyecto de pruebas.
2. Pausa temporalmente la creación de requerimientos durante el despliegue.
3. Si las dos primeras migraciones ya están aplicadas, abre **SQL Editor → New query**, pega **todo** el contenido de `supabase/migrations/202609020001_clientes_unidades_cantidad.sql` y ejecútalo una sola vez. Incluye `BEGIN` / `COMMIT`; un error revierte la migración completa.
4. No vuelvas a ejecutar migraciones antiguas. En una instalación vacía, el orden es:
   - `202608170001_initial_schema.sql`
   - `202608170002_performance.sql`
   - `202609020001_clientes_unidades_cantidad.sql`
5. Revisa clientes, unidades y cantidades; importa los datos faltantes según el orden siguiente.
6. Despliega este frontend y pide a los usuarios recargar sus pestañas.
7. Comprueba una solicitud con sesión de coordinador y su detalle/CSV con un administrador antes de reabrir la operación.

No ejecutes `seed.sql` en producción: es solo una demostración opcional. Ahora usa `ON CONFLICT DO NOTHING` y no sobrescribe registros.

### Consultas de revisión (solo lectura)

```sql
-- UUID para importar unidades:
select id, nombre, activo from public.clientes order by nombre;

-- Prendas sin un cliente de catálogo con nombre exactamente igual:
select p.id, p.codigo_prenda, p.cliente
from public.prendas p
left join public.clientes c on c.nombre = p.cliente
where c.id is null;

-- Requerimientos históricos cuyo destino no pudo completarse:
select id, agente_id, fecha, cliente_id, unidad_id
from public.requerimientos
where cliente_id is null or unidad_id is null
order by fecha;

-- Maestro a revisar antes de habilitar el flujo:
select codigo_prenda, nombre_prenda, cliente, cantidad, precio, codigo_almacen
from public.prendas
order by cliente, nombre_prenda;

-- Comprobar RLS:
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles','personal','prendas','requerimientos',
                    'detalle_requerimiento','clientes','unidades');
```

## Orden de importación

1. **Clientes**: CSV `nombre,activo`. No dupliques nombres ya migrados.
2. **Unidades**: CSV `cliente_id,nombre,activo`. Obtén el UUID de cada cliente con la consulta anterior. El mismo nombre puede existir en distintos clientes, no duplicarse dentro del mismo.
3. **Personal**: CSV `codigo_personal,nombre,dni,cargo,activo`. Ya no incluyas cliente ni unidad.
4. **Prendas**: CSV `codigo_prenda,nombre_prenda,codigo_almacen,precio,cliente,cantidad,activo`. `cliente` debe coincidir exactamente con `clientes.nombre`, incluidas mayúsculas, espacios y tildes. `cantidad` debe ser un entero positivo; omitirla asigna 1.

No incluyas `id` ni `created_at` salvo una importación controlada: se generan automáticamente. Conserva DNI y códigos como texto para no perder ceros iniciales. Las unidades sí necesitan el `cliente_id` generado previamente.

No se incluye CRUD nuevo de maestros en la UI: el administrador autorizado puede configurar los catálogos mediante las políticas nuevas o el operador puede importarlos desde Supabase, como ocurre con los maestros existentes. Cambiar el nombre de un cliente exige actualizar de forma coordinada su valor textual en prendas; no existe todavía una FK de prendas al catálogo.

## Flujo y UI

- Búsqueda por nombre, DNI o código; máximo 20 agentes, con debounce y cancelación. No obtiene cliente/unidad del agente.
- Paso 2: datos compactos del agente → Cliente → Unidad → Prendas solicitadas.
- Clientes activos ordenados por nombre; unidades activas filtradas en servidor por `cliente_id`.
- Cambiar cliente vacía unidad, prenda seleccionada y líneas agregadas. Las respuestas obsoletas se cancelan.
- Prendas deshabilitadas hasta elegir cliente y unidad; solo se cargan las del cliente elegido.
- Cantidad fija presentada como salida de solo lectura. Agregar una prenda repetida no acumula cantidades.
- Estados de carga, error con reintento, catálogo vacío y selección pendiente.
- El guardado no envía cantidades; PostgreSQL toma cantidad, precio y código vigentes del maestro y los copia al detalle dentro de una transacción.
- Bloqueo del doble envío y conservación de selecciones si falla el guardado.
- “Crear otro requerimiento” reinicia el formulario.
- Listados, filtros locales, detalle, administración y CSV usan las relaciones del requerimiento. Nunca usan el destino legado del agente.
- Consultas compartidas en `lib/requerimientos.ts`, con FK explícita para evitar ambigüedad entre las dos relaciones a unidades.

Se conserva el sistema corporate-product-ui: tipografía contenida, tarjetas compactas, etiquetas visibles, orden vertical de destino, cantidades no editables y footer de acciones responsive. El botón de guardar conserva ancho completo solo en móvil.

## Seguridad y rendimiento

- RLS permanece habilitado en todas las tablas; no se elimina ninguna política existente.
- Autenticados leen catálogos activos; solo admin puede insertar/actualizar clientes y unidades. No se concede eliminación.
- Un coordinador también puede leer un destino inactivo si figura en un requerimiento al que tiene acceso, para no perder nombres históricos. No accede a los destinos inactivos del historial de otros coordinadores.
- Nuevos INSERT requieren cliente/unidad activos y compatibles, también fuera del RPC. Los NULL se toleran solo para historial anterior.
- La cabecera sigue permitiendo únicamente cambios de estado; cliente/unidad quedan protegidos.
- El RPC exige usuario/perfil, agente activo, cliente y unidad activos, prendas únicas activas del cliente. Copia valores del maestro incluso si alguien envía cantidad/precio/código manipulados.
- Los registros de maestro se bloquean para lectura compartida durante el guardado, impidiendo que cambien entre validación y copia.
- Índices nuevos para cliente/fecha de requerimientos, unidad y catálogos activos. Se conservan todos los índices anteriores.
- Catálogos por páginas de 500: no se truncan a los primeros 200/1000 registros. Unidades/prendas se filtran en servidor; solo clientes activos se carga completo, según el flujo solicitado.
- Listados y exportación conservan su paginación existente. No se descarga el detalle completo para renderizar administración.

## Validación realizada

- `npm run lint`: correcto.
- `npm run typecheck`: correcto.
- `npm run build`: correcto.
- Tres migraciones ejecutadas sobre PostgreSQL 18 aislado con un esquema Auth mínimo de prueba.
- Migración sobre requerimientos previos: conserva cabeceras, datos legados y cantidades/precios/códigos históricos; completa destinos conocidos y deja desconocidos en NULL.
- `supabase/tests/clientes-unidades.sql`: pruebas transaccionales de guardado, cantidad manipulada, cliente/unidad incompatibles, duplicados, catálogos inactivos, permisos admin/coordinador/anon, aislamiento y RLS. Finaliza con ROLLBACK.
- Seed ejecutado dos veces sin duplicar ni sobrescribir datos.

Las pruebas SQL locales no sustituyen la integración con Auth/PostgREST de tu proyecto real. La validación autenticada de la interfaz y exportación queda para el entorno de pruebas después de aplicar la migración; no se modificó el Supabase remoto ni se simularon credenciales reales.

### Checklist de aceptación tras desplegar

1. Buscar un agente, comprobar que solo se muestran nombre, DNI y cargo.
2. Antes de elegir cliente: unidad y prendas deshabilitadas.
3. Elegir cliente y unidad; comprobar filtrado, cantidad fija y ausencia de input numérico.
4. Agregar prendas, cambiar cliente y comprobar que unidad/líneas se limpian.
5. Probar cliente sin unidades y cliente sin prendas.
6. Guardar; cotejar cantidad, precio y código con el maestro; repetir clic no debe duplicar solicitudes.
7. Ver destino en Mis requerimientos, detalle, administración y CSV.
8. Confirmar que otro coordinador no puede leer el requerimiento ni modificar catálogos.
9. Revisar formulario en 1440×900, 1366×768, 390×844, 375×812 y 320×700.
