# Auditoría de seguridad preproducción

Fecha: 2026-09-02. Proyecto: Requerimientos de Uniformes.

Actualización posterior: [revisión específica de los seis avisos del Security Advisor](docs/security-advisor.md). Añade la migración **006**, probada solo localmente: `public.is_admin()` pasa a ser una fachada INVOKER compatible y la comprobación elevada reside en `private.is_admin()`, con search_path `pg_catalog,pg_temp`. Las políticas y llamadas existentes se conservan. El informe base siguiente describe el estado hasta **005**; las referencias a siete migraciones y al antiguo is_admin DEFINER corresponden a esa primera auditoría. Para desplegar, aplicar también 006 después de revisar sus precondiciones y mantener private fuera de Data API. No se movió pg_trgm ni se cambió Auth remoto. La revisión adicional pasó las cinco suites SQL con las ocho migraciones, lint, typecheck, 92 pruebas npm y build.

## Dictamen y alcance

**Apto para continuar la preparación, no constituye aprobación del entorno remoto de producción.** Se corrigieron vulnerabilidades verificables en código y se preparó una migración de seguridad. Antes de publicar se debe aplicar el SQL pendiente y completar el checklist, especialmente deshabilitar el registro público y verificar privilegios reales.

Auditados: código actual, rutas, dependencias instaladas/lockfile, siete migraciones, las siete tablas funcionales y funciones de aplicación reconstruidas en PostgreSQL 18 local. Las pruebas de ataque usan usuarios ficticios y transacciones con rollback. No se aplicó SQL en Supabase remoto, no se accedió al Dashboard ni se certificaron secretos/rutas de GitHub no presentes en la copia local.

No se cambió diseño ni negocio. Las diferencias observables son correcciones de seguridad: solicitudes ilegales rechazadas, CSV protegido, error real de logout, respuestas API sin sesión como JSON 401 y HTML dinámico para CSP.

## Hallazgos clasificados

| ID | Gravedad | Hallazgo y evidencia | Resolución |
| --- | --- | --- | --- |
| A01 | ALTO | El CSV encerraba valores en comillas, pero una celda que empezaba con =,+,-,@ podía ejecutarse como fórmula al abrirse en Excel. | Corregido en `lib/admin/csv.ts`: prefijo de texto, controles/espacios iniciales y variantes Unicode; comillas escapadas. Pruebas adversariales. |
| A02 | ALTO | `authenticated` podía INSERT directo en requerimientos: elegir fecha/identificador y crear cabeceras sin detalles, omitiendo parte de la validación de la RPC. | Migración 005 revoca INSERT directo. La creación normal ya utilizaba la RPC atómica y sigue funcionando. |
| A03 | ALTO, condicionado al hosting | Respuestas que renuevan cookies no fijaban explícitamente no-store; un CDN mal configurado podría compartir cookies/datos. El callback no propagaba cabeceras de caché del SDK. | Proxy aplica private/no-store a respuestas normales, errores y redirects. HTML dinámico. Pendiente comprobar que el CDN respeta estas cabeceras. |
| A04 | ALTO, pendiente de verificar | Si Supabase permite signup público, una cuenta creada obtiene perfil coordinador y lectura de catálogos. Ocultar registro en la UI no impide llamar Auth directamente. | No se cambió el Dashboard. **Bloqueo de producción hasta confirmar registro público y usuarios anónimos deshabilitados.** |
| M01 | MEDIO | Grants implícitos/heredados de Supabase no estaban normalizados en todas las tablas. RLS no protege TRUNCATE; acceso SQL adicional podría aumentar el impacto. No se demostró un endpoint REST de TRUNCATE. | Migración 005 establece grants mínimos, revoca DELETE/TRUNCATE y permisos anon/PUBLIC sobre tablas. Conserva RLS y políticas. |
| M02 | MEDIO | Algunas funciones heredaban EXECUTE de PUBLIC/anon y search_path no explicitaba pg_temp al final. | Todas las funciones propias tienen path pg_catalog,public,pg_temp; CREATE en public revocado a roles no confiables. Triggers sin EXECUTE público; RPC permitidas solo authenticated. Prueba de tabla temporal impostora. |
| M03 | MEDIO | Redirects descartaban cookies renovadas; un perfil ausente/inválido podía producir bucle login/inicio. Logout ignoraba errores del SDK. | Cookies copiadas a redirects; perfil validado antes de redirigir desde login; logout fallido mantiene feedback y reintento. |
| M04 | MEDIO | Sin CSP/antiframe/headers defensivos explícitos, y Secure de cookies no estaba fijado para producción. | CSP con nonce por petición, headers, cookies Secure en producción/SameSite Lax. Origen cruzado rechazado en mutaciones. |
| M05 | MEDIO | JSON leído sin límite en handlers; RPC creación aceptaba parámetros de línea extra y no limitaba cantidad de líneas; búsquedas directas sin límite de longitud. | Lectura incremental 128 KiB para edición, 4 KiB para estado; JSON inválido 400, exceso 413. RPC limita 500 líneas/128 KiB y solo identificadores; búsqueda 120 caracteres, 50 resultados; filtros SQL administrativos 120 caracteres. |
| M06 | MEDIO, pendiente | No existe limitador distribuido de abuso propio. Exportaciones grandes todavía pueden consumir memoria; los límites funcionales no son rate limiting. | Propuesta operativa abajo; no se añadió un contador en memoria que pudiera evadirse en múltiples instancias. |
| B01 | BAJO | package.json usa latest en varios paquetes. npm install futuro puede introducir versiones mayores. | No se actualizaron dependencias sin aviso real. Usar npm ci con lockfile; recomendar fijar versiones y actualizar mediante PR. |
| B02 | BAJO | Solo .env*.local estaba ignorado; otros archivos .env y claves podían añadirse por accidente. | Se ignoran .env/.env.* (excepto .env.example), *.pem y *.key. El escáner redacta resultados. |

**CRÍTICO:** ninguno demostrado en el alcance local. No equivale a ausencia absoluta de vulnerabilidades ni a verificación del proyecto desplegado.

## Autenticación, cookies y autorización

- Proxy y Server Components verifican identidad mediante `auth.getUser()`; no se confía en datos de sesión sin verificar ni en un rol proporcionado por el navegador. El perfil/rol se consulta en PostgreSQL.
- Login usa el SDK contra Supabase Auth; las validaciones del formulario no son la frontera de seguridad. Email/contraseña, verificación de credenciales y rate limits dependen del servidor Auth. No hay endpoint propio que compare contraseñas ni Server Actions con privilegios.
- / sin sesión redirige a /login; con sesión, a /inicio. /login renderiza normalmente. Rutas privadas sin sesión redirigen; API devuelve 401 JSON, no un archivo HTML disfrazado de exportación.
- Destinos de redirect son rutas internas fijas. No se interpreta returnTo/next externo. Un header x-role o metadata role=admin no concede privilegios.
- Cookies: Path=/, SameSite=Lax y Secure en producción. No se cambió a HttpOnly: el SDK de navegador necesita leer las cookies para el flujo actual. Esto exige protección frente a XSS; no es equivalente a un backend de sesión exclusivamente HttpOnly. [Guía SSR de Supabase](https://supabase.com/docs/guides/auth/server-side/advanced-guide).
- Expiración/JWT, rotación, tiempo máximo y timeout de inactividad deben configurarse/comprobarse en Auth. El cierre elimina/revoca la sesión mediante el SDK; verificar también en staging el comportamiento de tokens de acceso previamente emitidos hasta su expiración. No prometer revocación instantánea de todo JWT offline.
- Coordinador: lectura/edición de requerimientos propios. Admin: lectura global, filtros, exportaciones y estado. Ambos editan prendas únicamente en Pendiente/Observado. Cabecera inmutable; Atendido bloqueado.
- Estado y SIDIGE: guardas de servidor + permisos/RLS/RPC, no solo controles ocultos. La API de edición no acepta agente_id, cliente_id, unidad_id, usuario_creador_id, fecha, referencia, estado, cantidad ni snapshots desde el cliente.

## Matriz RLS y privilegios efectivos esperados después de 005

RLS habilitada en las siete tablas. Ningún grant ni política DELETE para usuarios web. Anon/PUBLIC: sin SELECT/INSERT/UPDATE/DELETE/TRUNCATE en estas tablas.

| Tabla | SELECT authenticated | INSERT directo | UPDATE directo | DELETE |
| --- | --- | --- | --- | --- |
| profiles | Propio o admin | No; trigger Auth | No; rol solo por operador autorizado | No |
| personal | Activo o admin | No | No | No |
| clientes | Activo, admin o destino de requerimiento accesible | Solo admin por RLS | Solo admin por RLS | No |
| unidades | Activa, admin o destino de requerimiento accesible | Solo admin por RLS | Solo admin por RLS | No |
| prendas | Activa o admin | No | No | No |
| requerimientos | Propio o admin | No; RPC validada | Solo columna estado y solo admin | No |
| detalle_requerimiento | Solo activo y requerimiento propio/admin | No; RPC validada | No; RPC validada | No, además trigger impide borrado físico |

Las políticas de INSERT existentes en requerimientos se conservan, pero sin grant directo no conceden acceso. Grants y RLS deben permitir simultáneamente la operación. No se desactiva ninguna política.

Historial retirado permanece inmutable, con precio/código/cantidad originales; no es legible en operación normal ni exportable incluso por admin. El operador de base puede consultarlo explícitamente. No usar service_role en el servidor de aplicación: omite RLS.

## Funciones PostgreSQL

| SECURITY DEFINER | Control |
| --- | --- |
| handle_new_user() | Solo trigger Auth; inserta el ID/email del evento. No toma role de metadata. No usa auth.uid() porque corre durante creación administrativa de usuarios. Sin EXECUTE para roles web. |
| is_admin() | Comprueba auth.uid() contra profiles.role; solo authenticated puede ejecutar. No devuelve perfiles. |
| crear_requerimiento(uuid,uuid,uuid,jsonb) | UID/perfil con rol válido, agente activo, cliente/unidad válidos, prendas únicas del cliente, cantidades/snapshots desde maestro; transacción atómica. |
| obtener_edicion_prendas(uuid) | UID + admin o coordinador propietario; solo líneas activas del requerimiento permitido. |
| editar_prendas_requerimiento(uuid,text,jsonb) | Misma autorización, estado, pertenencia de líneas, versión, tamaño y duplicados; bloqueos y baja lógica atómica. |

Las funciones administrativas, búsqueda y firma antigua de creación son SECURITY INVOKER; la firma antigua solo devuelve un error de actualización de cliente. Funciones de trigger restantes no son RPC públicas.

Las consultas funcionales son estáticas/parametrizadas: texto de búsqueda no se concatena a SQL ejecutable. El SQL dinámico de la migración usa exclusivamente firmas tomadas de pg_catalog y una lista fija de funciones, no input de usuario. Rutas UUID son validadas por Zod o tipo UUID en PostgREST. Permitir elegir otro agente/cliente activo al CREAR es funcionalidad; alterar esos campos después de crear está bloqueado.

Los cambios en default privileges solo afectan objetos futuros del rol que ejecuta la migración; revisar otros propietarios manualmente. Ver [seguridad de funciones Supabase](https://supabase.com/docs/guides/database/functions).

## Inputs, XSS y archivos

- React escapa los textos; no se encontró dangerouslySetInnerHTML, eval de input ni construcción de SQL ejecutable con parámetros de usuario.
- Zod estricto en cambios de estado/edición. Lectura JSON limitada incluso cuando se omite/falsifica Content-Length. UUID inválidos, objetos adicionales, duplicados y arrays vacíos se rechazan.
- CSV protege fórmulas además de separar/escapar celdas. XLSX usa strings explícitos y formato texto, no objetos formula: =,+,-,@ permanecen texto literal sin alterar códigos SIDIGE. Cantidad/precio son números. [Riesgo CSV según OWASP](https://owasp.org/www-community/attacks/CSV_Injection).
- CSV y Excel requieren admin en servidor y consultan bajo la sesión del usuario; RLS y RPC administrativas excluyen ajenos/no autorizados e historial. No se cambian diez columnas ni reglas SIDIGE.

## Headers

CSP en Proxy: nonce aleatorio por respuesta, script-src con strict-dynamic, sin unsafe-eval en producción; connect-src permite el origen Supabase configurado y su WebSocket, no cualquier HTTPS; object-src/frame-ancestors/frame-src none. style-src conserva unsafe-inline por compatibilidad con estilos de Next.js; no se permite script inline sin nonce.

Next genera HTML dinámico para evitar nonces reutilizados. CSP se propaga tanto al request de render como a la respuesta. [Patrón CSP de Next.js](https://nextjs.org/docs/app/guides/content-security-policy).

X-Content-Type-Options nosniff, X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin y Permissions-Policy restringida. HSTS de un año solo en producción, sin includeSubDomains/preload hasta validar todos los subdominios. Cookies Secure/upgrade-insecure-requests requieren HTTPS en el dominio final.

## Secretos y GitHub

`git check-ignore .env.local` confirma ignorado; solo .env.example y next-env.d.ts están versionados como archivos relacionados con entorno. Las únicas variables expuestas encontradas son NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY. La clave local se clasificó como publishable; no se imprimió su valor.

El escáner `node scripts/security-scan.mjs` revisó checkout no ignorado, .env.local de forma redactada y 123 blobs de los 3 commits/refs locales: sin coincidencias de claves privadas, tokens secretos, JWT no públicos ni contraseñas literales detectadas. No se encontró service_role en código cliente. Escaneo heurístico, no prueba matemática de ausencia: revisar GitHub Secret Scanning, todas las ramas/tags/forks, logs de Actions, artifacts y secretos de deployment. Si hubo exposición, rotar antes de limpiar historial.

## Dependencias

npm audit inicial: **0 vulnerabilidades conocidas**. No se ejecutó npm audit fix --force ni se actualizaron paquetes mayores. La ausencia de avisos no certifica seguridad completa.

npm outdated encontró:

| Paquete | Instalado | Disponible al auditar |
| --- | --- | --- |
| next / eslint-config-next | 16.3.1 | 16.3.4 |
| @supabase/ssr | 0.12.4 | 0.12.5 |
| @supabase/supabase-js | 2.112.3 | 2.114.0 |
| zod | 4.4.3 | 4.5.4 |
| lucide-react | 1.31.0 | 1.39.0 |
| @eslint/eslintrc | 3.3.6 | 3.3.7 |
| @types/node | 26.2.0 | 26.4.1 |
| @types/react-dom | 19.2.4 | 19.2.5 |
| eslint | 9.39.5 | 10.9.1, mayor |
| typescript | 6.0.3 | 7.0.2, mayor |

Desactualizado no implica vulnerable. Actualizar parches/minores en PR de mantenimiento con regresiones; justificar aparte ESLint/TypeScript mayores. Producción: npm ci y mantener package-lock.json en Git.

## Rate limiting propuesto para ~22 coordinadores

No implementado como nueva infraestructura: requiere elegir gateway/almacén y configuración del hosting. Propuesta inicial, ajustar con métricas:

| Operación | Límite inicial propuesto |
| --- | --- |
| Login | Controles nativos Auth; 5 fallos/15 min por cuenta con enfriamiento progresivo y 30/15 min por IP; evitar bloqueo global por IP de oficina |
| Buscar | 60/min por usuario, ráfaga 10; debounce actual y máximo 50 resultados |
| Crear | 10/min por usuario y 100/h; respuesta 429 con Retry-After |
| Editar | 20/min por usuario; versión y bloqueo por requerimiento ya existentes |
| Exportar | 3/min por admin, una exportación concurrente; timeout, límite de filas/bytes y alertas de memoria |

No confiar en IP suministrada libremente en headers. Usar identidad verificada y almacenamiento compartido (Redis/gateway equivalente), no memoria de una instancia. WAF/CDN sobre Next no protege llamadas directas a Supabase: Auth necesita sus controles nativos; RPC requiere gateway efectivo sin bypass o cuotas transaccionales de BD. Los catálogos pueden consultarse directamente por usuarios autorizados; el límite de búsqueda no impide scraping de datos que su rol puede leer. No se cambia esa autorización.

CAPTCHA/MFA adicionales necesitan configuración y, según el caso, integración visible; no se activaron silenciosamente. Consultar [checklist de producción Supabase](https://supabase.com/docs/guides/deployment/going-into-prod).

## SQL pendiente y despliegue

En Supabase SQL Editor ejecutar **el contenido completo de**:

`supabase/migrations/202609020005_seguridad_produccion.sql`

Requiere las seis migraciones anteriores, en orden. No volver a ejecutar migraciones ya aplicadas ni seed/pruebas en producción. La migración no elimina datos ni desactiva RLS: modifica funciones y permisos. Hacer respaldo, aplicar migraciones pendientes, desplegar esta versión y validar con dos coordinadores y un admin ficticios en staging. No conceder privilegios amplios para solventar un error.

## Checklist manual obligatorio de Supabase/producción

- [ ] Auth: **Allow new users to sign up deshabilitado**, acceso solo mediante alta/invitación administrativa; anonymous sign-ins deshabilitados; proveedores no usados deshabilitados.
- [ ] Auth: revisar usuarios existentes y perfiles, solo admin/coordinador, eliminar accesos de exempleados mediante procedimiento autorizado; no convertir roles mediante metadata cliente.
- [ ] Auth: confirmar correo para usuarios, política fuerte de contraseñas, protección contra contraseñas filtradas si el plan la ofrece y rate limits adecuados; SMTP propio verificado.
- [ ] Auth: revisar JWT expiry, rotación/reutilización de refresh tokens, duración máxima e inactividad según plan; probar token vencido, revocado, logout y dos dispositivos.
- [ ] URL Configuration: Site URL HTTPS correcto y redirect allowlist exacta; sin wildcards de producción ni dominios antiguos.
- [ ] Equipo Supabase: MFA obligatorio para operadores/admin de proyecto, mínimo acceso y claves de BD fuera del navegador.
- [ ] Database/Security Advisor: revisar todas las tablas/vistas públicas reales, no solo las siete conocidas; RLS habilitada y políticas/grants coherentes con la matriz.
- [ ] Funciones: todos los DEFINER reales auditados, owners controlados, search_path fijo, no EXECUTE anon/PUBLIC accidental ni CREATE public para roles no confiables.
- [ ] Data API: solo esquemas necesarios expuestos; revisar límites de filas, timeouts y acceso a GraphQL/Storage/Realtime si existen.
- [ ] Claves: cliente solo publishable/anon; service_role/secrets exclusivamente en servicios administrativos autorizados; rotar cualquier secreto comprometido.
- [ ] Datos: backups/PITR según plan y restauración probada; proteger exportaciones con DNI, definir retención y acceso a archivos descargados.
- [ ] Logs: alertas de errores Auth, 401/403/429, picos de consultas/exports y cambios administrativos; nunca registrar contraseñas, cookies o tokens.
- [ ] Hosting/CDN: HTTPS, headers reales, no caché compartida de sesiones/respuestas privadas, límite de body y timeout; verificar origen público tras reverse proxy para CSRF.
- [ ] GitHub: Secret Scanning/push protection, ramas/forks/tags/Actions revisados; CI con npm ci, pruebas, audit y aprobación de cambios de seguridad.
- [ ] Staging: ejecutar matriz de ataques con sesiones reales separadas y llamadas REST/RPC directas; anon sin datos, coordinador sin acceso ajeno/estado/exportación, admin correcto.

Consultas de inspección (solo lectura, Dashboard):

```sql
select schemaname, tablename, rowsecurity
from pg_tables where schemaname='public';
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname='public';
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema='public' order by table_name, grantee;
select column_name, grantee, privilege_type
from information_schema.column_privileges
where table_schema='public' and table_name='requerimientos';
select p.oid::regprocedure, p.prosecdef, p.proconfig, p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef;
```

## Pruebas y reproducción

- npm test: pruebas de roles/propietarios, estado, RPC simuladas, payloads, CSV/XLSX real, CSRF, cookies, redirects y nonces.
- Cuatro scripts SQL locales: security.sql, clientes-unidades.sql, edicion-prendas.sql, admin-sidige.sql. Cubren llamadas directas, metadata/JWT role manipulado, perfil ajeno, estado, cabecera, baja lógica, reactivación/borrado rechazados y grants.
- Build Next real local en 3107: `node scripts/security-http.mjs` verifica login HTML/nonce, headers, cinco rutas privadas, cuatro endpoints anónimos, headers de bypass y CSRF. No hace peticiones al Supabase remoto.
- `node scripts/security-browser.mjs`: Edge aislado, login interactivo y rechazo de un script sin nonce insertado en HTML. Auth se simula y todo tráfico remoto real se bloquea. Inyectar código mediante la consola privilegiada de automatización no es una prueba válida de CSP; se comprueba el HTML que procesa el navegador.
- `node scripts/security-scan.mjs`: escaneo de secretos redactado.

No se hicieron pruebas de carga destructivas, brute force contra cuentas reales ni ataques al proyecto remoto. La configuración de Supabase Auth, el CDN real, los secretos de GitHub y la integración con sesiones remotas siguen sujetos al checklist.

Resultado: lint, typecheck, build y npm test correctos; 92 pruebas automatizadas de datos/API/seguridad y 22 visuales aprobadas; cuatro scripts SQL aprobados en base aislada; pruebas HTTP y navegador de producción local correctas; npm audit final con 0 vulnerabilidades. npm outdated se ejecutó sin actualizar paquetes.
