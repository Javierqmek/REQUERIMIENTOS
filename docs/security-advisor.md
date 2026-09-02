# Revisión de los seis avisos de Supabase Security Advisor

Fecha: 2026-09-02. Se contrastaron las siete migraciones existentes, sus definiciones efectivas (no solo la primera versión) y las llamadas TypeScript. Se preparó la octava migración `202609020006_security_advisor_hardening.sql`. **No se ejecutó SQL remoto ni se verificó el Dashboard.** Los avisos comunicados no demuestran que producción tenga aplicada la migración 005: comprobarlo antes de aceptar riesgos.

## Dictamen por aviso

| Aviso | Riesgo real y clasificación | ¿Esperado? | Recomendación / compatibilidad |
| --- | --- | --- | --- |
| `ExtensionInPublic: public.pg_trgm` | BAJO, organización/superficie del schema. No demuestra acceso a datos ni escalamiento; 005 revoca CREATE en public a roles web. | Sí, 002 instala sin schema explícito; localmente queda en public. | Aceptar por ahora. Moverla sola rompe `public.similarity` dentro de `buscar_personal`. No se mueve ni se reconstruyen índices. |
| `crear_requerimiento(uuid,uuid,uuid,jsonb)` DEFINER ejecutable | Superficie privilegiada intencional; residual BAJO para autorización bajo las validaciones de 005. Abuso de volumen sigue MEDIO, ver auditoría general. | Sí. La UI llama esta RPC para insertar cabecera y líneas atómicamente sin conceder INSERT directo. | Mantener EXECUTE authenticated y las validaciones. Revocarlo o pasar a INVOKER rompe creación; conceder DML para compensar debilitaría seguridad. |
| `editar_prendas_requerimiento(uuid,text,jsonb)` DEFINER ejecutable | Superficie privilegiada intencional; residual BAJO bajo los controles de propietario/rol/estado/líneas/versionado. | Sí. Es la vía de edición autorizada y baja lógica. | Mantener. Revocar EXECUTE o pasar a INVOKER rompe edición e historial; no conceder UPDATE directo. |
| `is_admin()` DEFINER ejecutable | BAJO: solo revela si el usuario actual es admin; no acepta ID ni rol. No concede admin al llamarlo. | Sí para RLS, pero no es necesario exponer una función elevada en public. | Migración 006: helper `private.is_admin()` DEFINER y fachada pública INVOKER compatible. No cambia autorización ni llamadas existentes. |
| `obtener_edicion_prendas(uuid)` DEFINER ejecutable | Superficie de lectura elevada; residual BAJO con control admin/propietario y filtro activo. | Sí: recupera snapshots y maestro ligado al requerimiento, incluso prendas del maestro ya inactivas. | Mantener EXECUTE authenticated. Cambiar a INVOKER puede perder información necesaria de prendas inactivas por RLS; no es un cambio neutral. |
| `LeakedPasswordProtectionDisabled` | MEDIO: exposición a reutilización de credenciales filtradas y credential stuffing. No prueba que exista una contraseña comprometida. | Limitación de plan si es Free; pendiente corregible si es Pro+. | Activar en Auth en Pro+. En Free aceptar explícitamente el riesgo residual con las mitigaciones indicadas abajo; no desaparece solo por endurecer longitud. |

No se encontró una escalada de privilegios reproducible en estas cuatro funciones con las migraciones completas. **No interpretar esto como autorización para dejar signup público habilitado.** El trigger asigna coordinador a una cuenta nueva: permitir altas no controladas es un riesgo ALTO independiente.

## Evidencia real de SECURITY DEFINER

La migración `202609020005_seguridad_produccion.sql` es determinante:

- Fija `search_path=pg_catalog,public,pg_temp` en todas las funciones de aplicación existentes; pg_temp queda al final. Revoca CREATE en public a PUBLIC/anon/authenticated.
- Revoca EXECUTE de PUBLIC, anon y authenticated, y concede después únicamente las RPC necesarias a authenticated. Los triggers no son ejecutables por roles web. El propietario administrativo sigue teniendo sus privilegios implícitos.
- Los cuerpos de las cuatro funciones señaladas usan `public.profiles`, `public.requerimientos`, `public.detalle_requerimiento`, `public.prendas`, etc., y `auth.uid()`. Las funciones built-in sin prefijo se resuelven con pg_catalog primero. No hay SQL dinámico derivado de parámetros.
- Roles admin/coordinador son valores en `public.profiles`, no roles PostgreSQL separados. Por eso el GRANT es a authenticated y la distinción se valida dentro de la función. No se toma `role` desde metadata, un parámetro JSON ni un header.

### Crear

La llamada real está en `components/new-requirement.tsx`. Ese componente no constituye la frontera de permisos: la función SQL sí lo es.

La definición final de 005 valida UID no nulo y perfil admin/coordinador; agente activo; cliente activo; unidad activa perteneciente al cliente. El JSON admite solo `prenda_id`, 1–500 líneas, máximo 128 KiB y UUID únicos. Cada prenda debe estar activa y corresponder al cliente. Cantidad/precio/código provienen del maestro bajo bloqueos; creador proviene de auth.uid(). No permite elegir creador, estado, fecha ni snapshots mediante el JSON.

Elegir cualquier agente y destino activos al crear es el negocio actual; PERSONAL ya no está asociado a cliente/unidad. No imponer una relación inexistente bajo pretexto de seguridad. La firma histórica `(uuid,jsonb)` quedó INVOKER y solo devuelve un error: no es una segunda vía de creación.

### Obtener y editar

`obtener_edicion_prendas` se define en 004 y su search_path/ACL se endurecen en 005. `editar_prendas_requerimiento` se redefine en 005. Ambas unen `public.profiles` usando `p.id=auth.uid()`: UID nulo/sin perfil no encuentra fila y recibe 42501. Solo admin o coordinador propietario puede continuar. Un UUID de requerimiento ajeno no evita esta guarda.

Obtener devuelve únicamente detalles activos del requerimiento permitido. Que el getter pueda leer un requerimiento Atendido no autoriza a editarlo. El editor bloquea Atendido para ambos roles y serializa edición/cambio de estado mediante FOR UPDATE. Valida versión actual, JSON acotado y claves permitidas; cada detalle conservado debe estar activo, pertenecer a ese requerimiento y coincidir con su prenda. Una línea retirada no puede reactivarse. Reagregar genera una línea nueva con valores actuales; el historial no se modifica. No hay parámetros que permitan escribir cabecera, cantidad arbitraria, precio ni código.

Las llamadas están en `lib/requirements/handlers.ts` y `app/(private)/requerimientos/[id]/editar/page.tsx`. No basta esconder botones: las pruebas SQL llaman directamente las RPC con distintos roles/propietarios y parámetros manipulados.

### is_admin: migración compatible

No conviene convertir simplemente la función actual a INVOKER: leer profiles evaluaría la política que vuelve a llamar is_admin, con riesgo de recursión. Tampoco revocar EXECUTE a authenticated: las políticas y RPC administrativas necesitan evaluarla.

006 mantiene `public.is_admin()` con su firma y OID, pero como INVOKER, y mueve la comprobación elevada a un nuevo helper `private.is_admin()`. Este consulta únicamente el UID actual, devuelve boolean y usa `search_path=pg_catalog,pg_temp`, con referencias completamente calificadas. No acepta parámetros. Ambos revocan PUBLIC/anon y permiten EXECUTE a authenticated; private permite USAGE, no CREATE. **La fachada pública seguirá siendo llamable directamente y devolverá el mismo booleano, sin elevar por sí misma privilegios.** No es un endpoint de asignación de rol.

Las 17 políticas conservan sus OID/expresiones y las RPC administrativas conservan sus llamadas `public.is_admin()`. No hay llamadas JS que necesiten migrarse. No se tocan filas ni grants sobre tablas. La migración aborta ante helper homónimo, schema privado de propietario no esperado o permisos inseguros; también evita ampliar USAGE sobre objetos privados previamente inaccesibles sin revisión. No debe forzarse con DROP/CASCADE.

**private debe quedar fuera de Data API > Exposed schemas.** SQL Editor puede no mostrar `pgrst.db_schemas`; verificar el Dashboard es obligatorio. El SQL oficial de [Advisor 0029](https://github.com/supabase/splinter/blob/main/splinter.sql) filtra funciones DEFINER ejecutables por authenticated en schemas expuestos. Con private no expuesto, el aviso de public.is_admin debería desaparecer; los otros tres son usos intencionales que el linter no distingue inspeccionando el cuerpo. Véase también [la explicación del aviso](https://github.com/supabase/splinter/blob/main/docs/0029_authenticated_security_definer_function_executable.md).

## pg_trgm: por qué no se mueve

`202608170002_performance.sql` crea tres índices GIN con `gin_trgm_ops` sin prefijo: nombre, DNI y código de personal. La búsqueda final de 005 llama explícitamente `public.similarity(...)` y tiene public en search_path, no extensions. Se revisaron las referencias del repositorio a similarity/trgm/buscar_personal.

En PostgreSQL local pg_trgm es relocatable. `ALTER EXTENSION ... SET SCHEMA` traslada sus objetos, incluidas funciones y opclasses; los índices existentes dependen de OID, no de una cadena de schema, por lo que no requieren recrearse solo por el traslado. Sin embargo, el cuerpo textual de buscar_personal **no se reescribe**: seguiría buscando public.similarity y fallaría. Nuevas instrucciones de índices que utilicen opclass sin calificar también pueden fallar cuando extensions no esté en search_path. [Documentación PostgreSQL](https://www.postgresql.org/docs/current/sql-alterextension.html).

Una futura migración coordinada tendría que inventariar dependencias reales, SQL externo, vistas, operadores y funciones no presentes en Git; verificar propietario, relocatable, colisiones y ACL de extensions; mover en transacción y actualizar buscar_personal a `extensions.similarity` junto con cualquier otra referencia. Calificar futuros índices con `extensions.gin_trgm_ops`; comprobar índices válidos, resultados/ranking, planes y acceso authenticated en staging. No basta añadir extensions al path porque la llamada actual tiene prefijo public explícito. No usar DROP EXTENSION/CASCADE.

**Decisión de esta revisión:** no incluir ese traslado en la migración. Aceptar el aviso de extensión, manteniendo CREATE public revocado y extensión actualizada mediante mantenimiento controlado. No hay evidencia remota suficiente para afirmar que un traslado no rompe otros consumidores.

## Contraseñas filtradas y Free

Supabase indica que Leaked Password Protection usa Pwned Passwords y está disponible en **Pro y superiores**, no en Free. [Fuente oficial: Password security](https://supabase.com/docs/guides/auth/password-security). No se verificó el plan concreto de este proyecto.

En Pro+: activar la protección en Authentication, configuración de contraseñas del proveedor Email. En Free: decisión explícita de riesgo residual, con estas medidas operativas:

- Configurar mínimo 12 caracteres, preferiblemente 16 o más; exigir mayúsculas, minúsculas, números y símbolos. Usar claves aleatorias distintas por usuario y gestor de contraseñas. Complejidad no equivale a detección de filtraciones.
- Prohibir claves basadas solo en DNI, nombres, fechas, secuencias o una clave común de la empresa. Un DNI con sufijo tampoco es una contraseña robusta. Revisar y sustituir credenciales iniciales previsibles mediante un procedimiento administrativo.
- Deshabilitar **Allow new users to sign up** y anonymous sign-ins en Auth; solo alta/invitación administrativa. No basta con no tener pantalla de registro. [Configuración oficial](https://supabase.com/docs/guides/auth/general-configuration).
- Mantener confirmación de email, direcciones verificadas y SMTP operativo; probar invitación/recuperación antes de exigir cambios. La confirmación demuestra control del correo, no solidez de contraseña. [Auth por contraseña](https://supabase.com/docs/guides/auth/passwords).
- Configurar rate limits de Auth, vigilar intentos fallidos y considerar CAPTCHA/MFA con integración planificada. Desactivar cuentas que ya no deban acceder.

`lib/validations.ts` permite mínimo 6 en el **formulario de login**. Esto no crea contraseñas ni configura la política Auth. No se eleva ese mínimo aquí: bloquearía el inicio de sesión de cuentas existentes sin mejorar sus credenciales en servidor. Endurecer en Auth para altas/cambios y gestionar renovación de contraseñas existentes; no asumir que una nueva política invalida automáticamente todas las antiguas.

## Aplicación manual, sin SQL remoto ejecutado por esta revisión

1. Ejecutar el archivo de **solo lectura** `supabase/inspection/security-advisor.sql` en SQL Editor y comparar definiciones/ACL con Git. Confirmar 005 aplicada, propietarios confiables y private no expuesto. Revisar cualquier diferencia antes de aceptar los avisos.
2. Respaldar y probar en staging. Si corresponde, aplicar las migraciones antiguas pendientes en orden; nunca volver a aplicar todas a una base ya migrada.
3. Ejecutar **el contenido completo** de `supabase/migrations/202609020006_security_advisor_hardening.sql` una sola vez, después de 005. Es transaccional. No ejecutar seed ni archivos de pruebas en producción. Si falla el preflight, revisar la causa; no ampliar permisos ni eliminar objetos para saltarlo.
4. Repetir inspección; probar login, perfiles/RLS, creación, edición propia, rechazo de ajenos y Atendido, administración y exportación. Refrescar Security Advisor.
5. Configurar Auth manualmente según plan; guardar evidencia de los controles y de la aceptación de riesgos.

## Resultado esperado del Advisor

- **Desaparece 1 de los 6:** public.is_admin como SECURITY DEFINER, después de aplicar 006 y mantener private fuera de los schemas expuestos. La implementación elevada sigue existiendo, sin exposición RPC propia.
- **Se aceptan 4:** pg_trgm en public y las tres RPC privilegiadas necesarias, condicionados a 005/006 y a no cambiar sus guardas/ACL.
- **El sexto depende de Auth:** desaparece al activar protección de filtradas en Pro+; permanece con aceptación documentada y mitigaciones en Free.

Por tanto: previsiblemente **5 avisos en Free**, o **4 en Pro+ con protección activada**, de los seis reportados. El número total puede diferir si el entorno tiene otros objetos/configuraciones o distinta versión del Advisor. No se ha observado el resultado remoto.

## Validación local

`supabase/tests/security-advisor.sql` verifica fachada INVOKER/helper DEFINER, ACL PUBLIC/anon/authenticated, schema no escribible, UID nulo/perfil inexistente, rol falsificado y tabla temporal impostora, RLS de perfiles sin recursión, compatibilidad de administración, los tres avisos RPC esperados y búsqueda/índices trigram intactos. Las otras cuatro suites SQL prueban autorización, creación, baja lógica, estado y exportación directamente en PostgreSQL aislado, con rollback de fixtures.

También se reconstruyeron desde cero las ocho migraciones y pasaron las cinco suites SQL en otra base aislada. Comandos de aplicación verificados: `npm run lint`, `npm run typecheck`, `npm test` (92 pruebas) y `npm run build`. No se cambiaron TypeScript, diseño, rutas, modelo ni lógica de negocio en esta revisión. Auth local es un simulador mínimo de UID/usuarios para pruebas SQL, no una certificación del servicio Supabase remoto.
