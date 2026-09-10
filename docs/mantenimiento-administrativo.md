# Mantenimiento administrativo

## Despliegue

No se ejecutó SQL remotamente. Si las migraciones anteriores ya están aplicadas, ejecuta una sola vez el contenido completo de `supabase/migrations/202609100003_mantenimiento_importaciones_borrado_pruebas.sql`, después de `202609100002_totales_requerimientos.sql`, y luego despliega el frontend.

La migración no concede `DELETE` sobre tablas, no desactiva RLS ni deshabilita triggers. Las operaciones elevadas viven en `private`; las fachadas públicas son `SECURITY INVOKER`, requieren sesión autenticada y vuelven a validar el rol admin en PostgreSQL.

## Eliminación de datos de prueba

Para mostrar y habilitar la función durante capacitación configura en el entorno del servidor:

```env
ALLOW_TEST_REQUIREMENT_DELETION=true
```

La operación requiere además que `private.app_config.allow_test_requirement_deletion` permanezca habilitada. La migración la deja en `true` para esta fase. Para cerrar completamente la función al pasar a producción:

```sql
update private.app_config
set habilitado = false, updated_at = now()
where clave = 'allow_test_requirement_deletion';
```

Configura también `ALLOW_TEST_REQUIREMENT_DELETION=false` y vuelve a desplegar. Así desaparecen los controles y tanto la ruta del servidor como la RPC rechazan llamadas manuales.

La RPC acepta de 1 a 100 UUID únicos, bloquea y verifica que todos existan antes de borrar, elimina detalle y cabecera en una sola transacción y admite Pendiente, Observado y Atendido. El trigger `proteger_historial_detalle` solo permite el `DELETE` mientras el marcador privado de la RPC está activo; la propia función lo devuelve a `off` antes de responder. Cualquier error revierte cabeceras y detalles.

## Catálogos

Administración → Mantenimiento permite listar, buscar, paginar y cambiar `activo` en clientes, unidades, personal y prendas. Unidades se filtran por cliente; prendas por cliente y género. No existe borrado físico de catálogos. Los formularios nuevos ya filtran `activo = true`, mientras las políticas históricas conservan los nombres asociados a requerimientos existentes.

## Importaciones CSV

Administración → Importaciones soporta personal y prendas con un máximo de 1 MB y 1,000 filas.

- Personal: `codigo_personal,nombre,dni,cargo,activo`.
- Prendas: `codigo_prenda,nombre_prenda,codigo_almacen,precio,cantidad,cliente,genero,activo`.

La vista previa valida encabezados, número de columnas, códigos repetidos, DNI de 8 a 12 dígitos, booleanos, precio, cantidad, género y cliente existente. No escribe durante la previsualización. Al confirmar, los códigos existentes se actualizan, los nuevos se insertan y los duplicados del archivo se omiten; nunca se borra automáticamente.

## Validación local

La base se reconstruyó desde cero con todas las migraciones en PostgreSQL 18. Las pruebas cubren eliminación individual y múltiple, los tres estados, denegación a coordinador, bloqueo de `DELETE` directo, trigger habilitado, rollback simulado, baja lógica de catálogos, upsert sin duplicados y rechazo de importaciones inválidas. SIDIGE mantiene su contrato de diez columnas.
