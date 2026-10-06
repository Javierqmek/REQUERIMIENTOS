# Requerimientos de Uniformes

Aplicación web para que coordinadores registren solicitudes de prendas por agente y los administradores consulten, exporten y actualicen su estado. Es mobile-first y utiliza Next.js, TypeScript, Tailwind CSS y Supabase (PostgreSQL, Auth y Row Level Security).

## 1. Antes de comenzar

Necesitas instalar [Node.js](https://nodejs.org/) y crear cuentas gratuitas en [Supabase](https://supabase.com/) y [Vercel](https://vercel.com/). No guardes contraseñas ni claves privadas dentro del proyecto.

## 2. Instalar la aplicación

Abre una terminal en esta carpeta y ejecuta:

```bash
npm install
```

## 3. Crear y preparar Supabase

1. En Supabase pulsa **New project**, elige una organización, un nombre y una contraseña segura para la base de datos.
2. Espera a que termine la creación.
3. Abre **SQL Editor**, pulsa **New query**, copia y ejecuta en orden todos los archivos de `supabase/migrations/`: `202608170001_initial_schema.sql`, `202608170002_performance.sql`, `202609020001_clientes_unidades_cantidad.sql`, `202609020002_admin_sidige.sql`, `202609020003_rol_coordinador.sql`, `202609020004_detalle_baja_logica_edicion.sql`, `202609020005_seguridad_produccion.sql`, `202609020006_security_advisor_hardening.sql`, `202609100001_prendas_genero.sql`, `202609100002_totales_requerimientos.sql`, `202609100003_mantenimiento_importaciones_borrado_pruebas.sql` y `202609130001_admin_catalogos_crud.sql`. Esto crea tablas, relaciones, validaciones, guardado atómico, RLS, índices, auditoría y funciones administrativas seguras. Antes de 006 revisa [los avisos del Security Advisor](docs/security-advisor.md): `private` no debe exponerse en Data API. En proyectos existentes aplica solo migraciones pendientes, primero en staging.
4. Crea otra consulta, copia `supabase/seed.sql` y pulsa **Run**. Solo en una base de demostración: carga dos clientes, dos unidades, tres agentes y cuatro prendas; no sobrescribe registros existentes.
5. En **Authentication > Providers**, confirma que Email está activado. Para pruebas internas puedes desactivar **Confirm email**; en producción conviene mantenerlo activado.

## 4. Conectar la aplicación

En Supabase abre **Project Settings > API** (en algunas versiones aparece como **Connect > App Frameworks**). Copia:

- **Project URL**: es `NEXT_PUBLIC_SUPABASE_URL`.
- **anon / publishable key**: es `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Usa la clave pública, nunca `service_role` ni una clave secreta.

Copia `.env.example` con el nombre `.env.local` y reemplaza los ejemplos:

```env
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu-clave-publica
```

## 5. Crear usuarios y el primer administrador

Toda cuenta nueva (sin importar cómo se creó: Add user, Google, o un registro público por correo)
recibe automáticamente el rol `sin_vincular` -- sin acceso a ninguna página privada. Esto es
deliberado: el módulo de Capacitaciones permite que los agentes se registren solos con Google, así
que ninguna cuenta nueva puede quedar con un rol con privilegios por default. Después de crear
cualquier cuenta de staff (superadmin, admin, coordinador, gerente o capacitador) hay que asignarle
su rol a mano, siempre.

### Roles disponibles

- **superadmin**: acceso total a todos los módulos (Inicio, Mis requerimientos, Documentos incluidas
  Vacaciones/Papeletas, Capacitaciones Gestión y Agentes, Administración) más la gestión de usuarios
  y roles.
- **admin**: restringido a Inicio (solo la parte de uniformes), Mis requerimientos y Administración
  completa (Requerimientos, Mantenimiento, Importaciones). No ve ni puede usar Documentos (ni
  Vacaciones/Papeletas) ni Capacitaciones -- estas rutas lo redirigen y sus RLS/RPC lo rechazan
  aunque entre por URL directa o llame a la API a mano.
- **coordinador**, **gerente**, **capacitador**, **agente**: sin cambios, mantienen exactamente el
  acceso que ya tenían antes de separar superadmin de admin.

### Primer superadmin (por SQL, una sola vez)

1. En Supabase abre **Authentication > Users > Add user > Create new user**.
2. Escribe correo y contraseña.
3. Crea primero el usuario que será superadmin.
4. Abre **SQL Editor** y ejecuta lo siguiente cambiando el correo:

```sql
update public.profiles
set role = 'superadmin', nombre = 'Administrador'
where email = 'administrador@empresa.com';
```

Sin este paso, la cuenta queda en `sin_vincular` y no puede entrar a nada -- ni siquiera al login
normal por correo+contraseña la deja pasar (ver `lib/auth.ts` / `lib/capacitaciones/auth.ts`).
Para cambiar solo el nombre visible de alguien ya asignado puedes ejecutar el mismo `update` sin
tocar `role`.

### Resto de usuarios (admin, coordinador, gerente, capacitador) -- sin SQL

Con un superadmin ya creado, todos los demás roles de staff se asignan desde la propia app: crea
la cuenta en **Authentication > Users > Add user**, inicia sesión como superadmin, entra a
**Administración > Usuarios y roles** (`/admin/usuarios`, visible solo para superadmin) y elige el
rol de la lista desplegable junto al correo del usuario. La pantalla llama a la función
`superadmin_cambiar_rol`, que valida el rol en el servidor y evita que un superadmin se quite su
propio rol por accidente. Los agentes no se crean aquí: se vinculan solos con Google + DNI desde
Capacitaciones (ver `docs/` para el detalle de ese flujo) y solo un superadmin puede desvincularlos.

## 6. Ejecutar localmente

```bash
npm run dev
```

Abre `http://localhost:3000` e inicia sesión. Para revisar la calidad del código:

```bash
npm run lint
npm run typecheck
npm run build
```

## 7. Importar catálogos, personal y prendas

Prepara archivos CSV con encabezados equivalentes a las columnas de cada tabla. En Supabase abre **Table Editor** y usa **Insert > Import data from CSV**. Orden: clientes → unidades → personal → prendas.

Para `clientes`: `nombre,activo`. Para `unidades`: `cliente_id,nombre,renovacion_defecto,activo` (usa los UUID generados en clientes; `renovacion_defecto` es VERANO o INVIERNO y vale VERANO si se omite). Para `personal`: `codigo_personal,nombre,dni,cargo,activo`. Para `prendas`: `codigo_prenda,nombre_prenda,genero,codigo_almacen,precio,activo` (la ficha, una sola vez); su cliente, renovación y cantidad van en `prenda_clientes` (usa Mantenimiento → Prendas o Importaciones).

No incluyas `id` ni `created_at`: Supabase los genera. `genero` admite HOMBRE, MUJER y AMBOS; HOMBRE/MUJER y UNISEX se normalizan como AMBOS.  Conserva DNI y códigos como texto; en Excel conviene asignar formato **Texto** antes de guardar el CSV. El valor de `prendas.cliente` debe coincidir exactamente con `clientes.nombre`. La cantidad debe ser un entero positivo; si se omite vale 1. El agente no tiene destino asignado: cliente y unidad se eligen en cada requerimiento.

## 8. Desplegar en Vercel

1. Sube esta carpeta a un repositorio Git (GitHub, GitLab o Bitbucket).
2. En Vercel pulsa **Add New > Project**, importa el repositorio y deja detectado **Next.js**.
3. En **Environment Variables** agrega `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` con los mismos valores de `.env.local`.
4. Pulsa **Deploy**.
5. En Supabase abre **Authentication > URL Configuration**. Coloca la URL de Vercel como **Site URL** y agrégala a **Redirect URLs**. La autenticación por contraseña funciona de inmediato; esta preparación también facilita añadir magic link posteriormente.

## Seguridad incluida

- Toda ruta privada valida la sesión en servidor y middleware.
- RLS limita al coordinador a sus propios requerimientos y detalles.
- Solo admin puede actualizar `estado`; nadie puede editar la cabecera. Coordinador edita prendas propias y admin las de cualquier requerimiento, únicamente en Pendiente/Observado.
- Las líneas retiradas se conservan mediante baja lógica, ocultas de consultas operativas, conteos y exportaciones. No se permite borrarlas ni reactivarlas.
- El guardado usa una función PostgreSQL atómica: si falla un detalle, no queda una cabecera incompleta.
- Cantidad fija, precio y código de almacén se copian desde el maestro al detalle para conservar el historial.
- La base valida cantidades positivas, prendas no repetidas, destino activo y pertenencia de unidad/prendas al cliente elegido. Rechaza cantidades, precios y códigos enviados por el navegador: deben provenir del maestro.

## Rendimiento

- La búsqueda de agentes usa índices trigram y devuelve como máximo 20 coincidencias.
- Las búsquedas en curso se cancelan al seguir escribiendo, evitando respuestas duplicadas o fuera de orden.
- Los catálogos se leen por bloques de 500 y solo con columnas necesarias. Unidades y prendas se filtran en servidor por el cliente elegido; no se descargan prendas de otros clientes. Las cargas obsoletas se cancelan.
- Los listados iniciales están acotados: 100 requerimientos propios y 50 filas administrativas, con carga incremental para consultar los siguientes bloques.
- El panel administrativo ya no descarga el detalle completo de prendas para renderizar la tabla.
- La exportación CSV se genera en el servidor en bloques de 250 registros, manteniendo RLS y autorización de administrador.
- Usuario y perfil se deduplican entre layouts y páginas durante el mismo render de servidor.
- La migración de rendimiento agrega índices para creador, agente, detalle, prenda, fecha, estado y búsqueda por nombre/DNI/código.

## Estructura principal

- `app/`: rutas y pantallas.
- `components/`: componentes interactivos reutilizables.
- `lib/`: Supabase, tipos y validaciones Zod.
- `supabase/migrations/`: esquema y políticas de seguridad.
- `supabase/seed.sql`: datos de prueba.

## Migrar una instalación existente

Ejecuta únicamente las migraciones pendientes en el orden del apartado 3 antes de desplegar este frontend. No vuelvas a ejecutar migraciones ya aplicadas ni el seed en producción. Consulta [la guía de catálogos](docs/clientes-unidades-cantidad.md) y [roles, edición y baja lógica](docs/roles-edicion-baja-logica.md) para compatibilidad, SQL de revisión y pruebas.

## Administración y Excel SIDIGE

Consulta [clasificación e importación de prendas por género](docs/prendas-genero.md) antes de desplegar el nuevo selector. La migración debe aplicarse primero; no agrega género a SIDIGE ni al detalle histórico.

## Tipo de renovación (Verano / Invierno) y prendas no repetidas

Aplica `202610020001_renovacion_prendas_unicas.sql` (una sola ejecución, después de `202609250002`). Las prendas existentes quedan como AMBOS y los requerimientos existentes como VERANO.

- **Formulario**: antes de "Género" se elige el *Tipo de renovación* (obligatorio). Al elegir la unidad se preselecciona su "Renovación por defecto" (Mantenimiento → Unidades, Verano por defecto), pero el usuario puede cambiarla. Una prenda aparece si su renovación es la elegida o AMBOS y su género es el elegido o AMBOS. Si al cambiar renovación o género hay prendas que ya no corresponden, se avisa y se quitan.
- **Mantenimiento → Unidades** edita `renovacion_defecto`. La renovación de una prenda va en sus asignaciones por cliente (ver la sección siguiente).
- **Importación de prendas (CSV)**: ver la sección siguiente (se importa por cliente). `renovacion` (o `Renovación`) acepta Verano, Invierno o Ambos sin importar mayúsculas ni tildes; un valor inválido se informa con el número de fila.
- **Detalle, listados, filtros y exportaciones** (CSV y Excel SIDIGE) muestran y filtran por renovación. La columna *Ref.Int.* de SIDIGE ahora es `RENOVACION VERANO` o `RENOVACION INVIERNO` según el requerimiento, y el archivo se llama `MIGRADOR_RENOVACION_<VERANO|INVIERNO|TODAS>_AAAAMMDD_HHmm.xlsx`.
- **Una prenda una sola vez por requerimiento**: si se necesita más, se sube la cantidad (fija en el maestro). El mismo trabajador sí puede tener la misma prenda en otro requerimiento. En pantalla las ya agregadas salen en gris, tachadas, con la etiqueta "Ya agregada" y no se pueden elegir (al crear y al editar); en servidor lo valida la RPC (`22023`) y el índice único parcial `detalle_prenda_activa_unique` (requerimiento, prenda) entre líneas activas, vigente desde `202609020004`.

## Prendas por cliente: ficha única + asignaciones (migración `202610060001`)

Antes cada prenda tenía un solo cliente y la importación hacía upsert por `codigo_prenda`: importar INDECOPI movía a INDECOPI las prendas con códigos que ya eran de RENIEC. Ahora:

- **Ficha** (`prendas`, una sola vez): código (único), nombre, código de almacén y precio (el género va en la asignación, ver abajo). El precio es el mismo para todos los clientes.
- **Asignación** (`prenda_clientes`): prenda + cliente + renovación (VERANO, INVIERNO o AMBOS) + cantidad + activo. Permitido: la misma prenda y cliente con una fila VERANO y otra INVIERNO de cantidades distintas (p. ej. bloqueador `ACS0206` de INDECOPI: Verano 6, Invierno 3). No permitido (restricción en base de datos): filas duplicadas (prenda, cliente, renovación) ni AMBOS activo junto con VERANO/INVIERNO para la misma prenda y cliente.
- **Formulario y servidor**: solo se ofrecen las prendas asignadas al cliente del requerimiento cuya renovación coincida (o AMBOS) y cuyo género coincida, con la cantidad de esa asignación. `crear_requerimiento` y `editar_prendas_requerimiento` rechazan una prenda no asignada a ese cliente y renovación. Las líneas de requerimientos ya registrados no cambian (guardan prenda, cantidad y precio).
- **Mantenimiento → Prendas**: la ficha muestra y edita sus asignaciones (cliente, renovación, cantidad, activo; no se borran, se desactivan) y tiene filtro por cliente.
- **Importaciones → Prendas** (un archivo por cliente): columnas `codigo_prenda, nombre_prenda, codigo_almacen, precio, cantidad, genero, renovacion, activo` (en cualquier orden; `cliente` opcional, y si viene debe ser el elegido). CSV en UTF-8 o Windows-1252; se limpian los espacios (`"UNF1 "` → `UNF1`).
  - Solo crea o modifica asignaciones de ese cliente; nunca las de otro.
  - Si el código ya existe se reutiliza la ficha. Si precio, nombre, almacén o género del archivo difieren de lo guardado, **no se cambian**: la vista previa avisa ("Precio actual S/ 40.00, en el archivo S/ 45.00") y el usuario elige *Mantener actual* (por defecto) o *Actualizar* por prenda.
  - Errores con número de fila: mismo código, cliente y renovación repetidos; mismo código con datos de ficha distintos (p. ej. dos precios) en el archivo; AMBOS mezclado con VERANO/INVIERNO; renovación, género, precio o cantidad inválidos.
  - Vista previa antes de aplicar: prendas nuevas, asignaciones nuevas, cantidades actualizadas, alertas y errores. *Reemplazar catálogo de este cliente* desactiva (no borra) las asignaciones del cliente que no estén en el archivo y las lista antes; no se aplica si hay errores.
  - Cada importación queda en `private.admin_catalog_audit` (acción `IMPORTAR`) con el estado anterior de lo tocado.
- **Recuperar un cliente afectado**: la importación anterior no guardó historial. [`supabase/inspection/recuperar-prendas-cliente.sql`](supabase/inspection/recuperar-prendas-cliente.sql) (solo lectura) lista lo que se puede deducir de los requerimientos del cliente y propone, comentada, una restauración. Lo más simple es reimportar el archivo del cliente con el modelo nuevo. La migración guarda en `private.prendas_asignacion_respaldo` los valores anteriores (cliente, cantidad, renovación) de todas las prendas.

## Género por asignación y cambio de precio con alcance (migración `202610070001`)

- **Género en la asignación**: una misma prenda puede ser HOMBRE para un cliente y AMBOS para otro (la corbata `11UNTCPLC073`: HOMBRE en RENIEC, AMBOS en INDECOPI). `prendas.genero` se eliminó (valores anteriores en `private.prendas_genero_respaldo`) y `prenda_clientes.genero` se llenó con el valor de la ficha. El formulario filtra por el género de la asignación del cliente; `crear_requerimiento` recibe `p_genero` (Hombre o Mujer, obligatorio) y `editar_prendas_requerimiento` `p_genero` opcional, y rechazan prendas cuya asignación no sea de ese género o AMBOS. Mantenimiento edita el género en cada asignación. La importación actualiza solo el género de las asignaciones del cliente del archivo, sin alerta (las alertas de ficha son solo precio, nombre y código de almacén).
- **Qué copian las líneas de requerimiento**: al crearse guardan copia de `cantidad`, `precio_unitario` y `codigo_almacen`. El **nombre no se copia**: se lee en vivo de la ficha, así que cambiarlo se ve en todos los requerimientos. Los totales se calculan en vivo desde las líneas.
- **Cambio de precio o código de almacén con alcance** (Mantenimiento o "Actualizar" en una alerta de importación): *Solo desde ahora* (solo la ficha), *También en trámite* (además las líneas de requerimientos Pendiente u Observado; Atendido es el único estado cerrado, no existen "enviado a SIDIGE" ni "aprobado") o *Todos* (también Atendido; solo superadmin, puede no coincidir con lo ya cargado en SIDIGE). Antes de aplicar se muestra cuántos requerimientos y líneas cambian. Cada cambio queda en `private.admin_catalog_audit` (acción `CAMBIAR_FICHA`) con prenda, valor anterior y nuevo, alcance, usuario, fecha y las líneas afectadas (id y valores anteriores, para poder revertir). Las líneas retiradas no se tocan y el historial sigue protegido contra cualquier otro cambio.
- **Importación desde Excel en español**: separador `,` o `;` autodetectado (también tabulador o `sep=;`), precios `S/ 1,250.50` (también `1.250,50` o `60,5`), filas totalmente vacías (`;;;;;;;`) ignoradas y sin contar para el límite de 1000, y los errores indican el número de fila original del archivo. Si el archivo trae una sola renovación para una prenda, reemplaza la vigente (AMBOS ↔ VERANO/INVIERNO) y la vista previa lo muestra como *Renovación actualizada*; solo es error si el mismo archivo mezcla AMBOS con VERANO o INVIERNO para la misma prenda.
- El generador de la migración está en [`supabase/scripts/gen_202610070001.py`](supabase/scripts/gen_202610070001.py) (reutiliza las definiciones vigentes de cada función y verifica cada reemplazo); el SQL final es la migración.

Los totales visibles en creación, Mis requerimientos y Administración se documentan en [totales de requerimientos](docs/totales-requerimientos.md). En una instalación ya migrada aplica únicamente `202609100002_totales_requerimientos.sql`, después de la migración de género y antes de desplegar este frontend.

Administración incorpora filtros combinables en servidor, contador global, paginación, sumatoria de prendas y exportación XLSX SIDIGE con una fila por prenda. CSV permanece disponible y respeta los mismos filtros. Ejecuta la migración pendiente `202609020002_admin_sidige.sql` antes de desplegar esta versión; añade solo funciones de lectura con control admin, sin cambiar tablas ni RLS.

Consulta [la guía de Administración y SIDIGE](docs/administracion-sidige.md) para el contrato de Excel, seguridad, despliegue y pruebas. `npm test` ejecuta las pruebas de datos y endpoints; `npm run test:ui` prueba los componentes en un entorno visual aislado.

El mantenimiento, las importaciones web y la eliminación temporal de requerimientos de prueba están documentados en [mantenimiento administrativo](docs/mantenimiento-administrativo.md). La eliminación falla de forma segura mientras `ALLOW_TEST_REQUIREMENT_DELETION` no sea `true` en el servidor.

## Roles y edición de prendas

Desde el detalle, “Editar prendas” permite modificar el conjunto solicitado sin editar agente, destino ni cabecera. Cantidad fija desde el maestro; precio/código históricos para líneas conservadas. Retirar y volver a agregar crea otra línea activa con los valores actuales. Atendido bloquea a ambos roles. Ver [migraciones, conservación del historial y validaciones](docs/roles-edicion-baja-logica.md).

## Seguridad antes de producción

Revisar [SECURITY_AUDIT.md](SECURITY_AUDIT.md), aplicar la migración de seguridad pendiente y completar su checklist. Confirmar en Supabase que signup público y usuarios anónimos estén deshabilitados. Las verificaciones locales no certifican el Dashboard ni GitHub remotos. Usar HTTPS en producción y `npm ci` para instalar las versiones del lockfile.

La [revisión de los seis avisos de Supabase](docs/security-advisor.md) explica cuáles aceptar, la fachada compatible `public.is_admin()`/helper privado de 006 y la protección de contraseñas según plan. `supabase/inspection/security-advisor.sql` permite comparar la configuración real mediante consultas de solo lectura. No se trasladó `pg_trgm` ni se aplicaron migraciones remotamente durante esta revisión.
# Módulo documental

La arquitectura, seguridad, flujo, migración y checklist de firma electrónica interna están documentados en [docs/gestion-documentos-firma.md](docs/gestion-documentos-firma.md).
