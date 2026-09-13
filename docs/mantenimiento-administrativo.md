# Mantenimiento administrativo

## Despliegue

No se ejecutó SQL remotamente. Si las migraciones anteriores ya están aplicadas, ejecuta una sola vez y en orden `supabase/migrations/202609100003_mantenimiento_importaciones_borrado_pruebas.sql` y `supabase/migrations/202609130001_admin_catalogos_crud.sql`, y luego despliega el frontend.

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

Administración → Mantenimiento permite listar, buscar, paginar, crear, editar y cambiar `activo` en clientes, unidades, personal y prendas. Unidades se filtran por cliente; prendas por cliente y género. Cliente y unidad solo ofrecen eliminación definitiva cuando la consulta no detecta relaciones; la RPC repite esa comprobación bajo bloqueo antes de borrar. Personal y prendas nunca ofrecen borrado físico.

Renombrar un cliente actualiza en la misma transacción el campo legado `prendas.cliente`; los UUID de requerimientos y las líneas de detalle permanecen intactos. Una unidad usada no puede cambiar de cliente. Un cliente inactivo no admite nuevas unidades activas hasta ser reactivado.

La tabla privada `private.admin_catalog_audit` registra usuario, acción, catálogo, identificador, valores anteriores/posteriores y fecha. No es accesible por `anon` ni `authenticated`.

Antes de aplicar la migración, comprueba que no existan duplicados ignorando mayúsculas/minúsculas:

```sql
select lower(btrim(nombre)), count(*) from public.clientes group by 1 having count(*) > 1;
select cliente_id, lower(btrim(nombre)), count(*) from public.unidades group by 1,2 having count(*) > 1;
```

Si alguna consulta devuelve filas, corrige esos nombres manualmente antes de migrar. La migración falla de forma transaccional y no elimina datos.

## Importaciones CSV

Administración → Importaciones soporta personal y prendas con un máximo de 1 MB y 1,000 filas.

- Personal: `codigo_personal,nombre,dni,cargo,activo`.
- Prendas: `codigo_prenda,nombre_prenda,codigo_almacen,precio,cantidad,cliente,genero,activo`.

La vista previa valida encabezados, número de columnas, códigos repetidos, DNI de 8 a 12 dígitos, booleanos, precio, cantidad, género y cliente existente. No escribe durante la previsualización. Al confirmar, los códigos existentes se actualizan, los nuevos se insertan y los duplicados del archivo se omiten; nunca se borra automáticamente.

## Validación local

La base se reconstruyó desde cero con todas las migraciones en PostgreSQL 18. Las pruebas cubren eliminación individual y múltiple, los tres estados, denegación a coordinador, bloqueo de `DELETE` directo, trigger habilitado, rollback simulado, baja lógica de catálogos, upsert sin duplicados y rechazo de importaciones inválidas. SIDIGE mantiene su contrato de diez columnas.
