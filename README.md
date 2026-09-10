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
3. Abre **SQL Editor**, pulsa **New query**, copia y ejecuta en orden todos los archivos de `supabase/migrations/`: `202608170001_initial_schema.sql`, `202608170002_performance.sql`, `202609020001_clientes_unidades_cantidad.sql`, `202609020002_admin_sidige.sql`, `202609020003_rol_coordinador.sql`, `202609020004_detalle_baja_logica_edicion.sql`, `202609020005_seguridad_produccion.sql`, `202609020006_security_advisor_hardening.sql`, `202609100001_prendas_genero.sql` y `202609100002_totales_requerimientos.sql`. Esto crea tablas, relaciones, validaciones, guardado atómico, RLS, índices, consultas administrativas, edición de prendas con historial, clasificación por género y totales históricos. Antes de 006 revisa [los avisos del Security Advisor](docs/security-advisor.md): `private` no debe exponerse en Data API. En proyectos existentes aplica solo migraciones pendientes, primero en staging.
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

1. En Supabase abre **Authentication > Users > Add user > Create new user**.
2. Escribe correo y contraseña. Al crear el usuario, la migración genera automáticamente su perfil como coordinador.
3. Crea primero el usuario que será administrador.
4. Abre **SQL Editor** y ejecuta lo siguiente cambiando el correo:

```sql
update public.profiles
set role = 'admin', nombre = 'Administrador'
where email = 'administrador@empresa.com';
```

Los demás usuarios quedan como `coordinador`. Para cambiar el nombre visible de un coordinador puedes ejecutar el mismo `update`, sin modificar `role`.

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

Para `clientes`: `nombre,activo`. Para `unidades`: `cliente_id,nombre,activo` (usa los UUID generados en clientes). Para `personal`: `codigo_personal,nombre,dni,cargo,activo`. Para `prendas`: `codigo_prenda,nombre_prenda,genero,codigo_almacen,precio,cantidad,cliente,activo`.

No incluyas `id` ni `created_at`: Supabase los genera. `genero` admite HOMBRE, MUJER y AMBOS; HOMBRE/MUJER y UNISEX se normalizan como AMBOS. Conserva DNI y códigos como texto; en Excel conviene asignar formato **Texto** antes de guardar el CSV. El valor de `prendas.cliente` debe coincidir exactamente con `clientes.nombre`. La cantidad debe ser un entero positivo; si se omite vale 1. El agente no tiene destino asignado: cliente y unidad se eligen en cada requerimiento.

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

Los totales visibles en creación, Mis requerimientos y Administración se documentan en [totales de requerimientos](docs/totales-requerimientos.md). En una instalación ya migrada aplica únicamente `202609100002_totales_requerimientos.sql`, después de la migración de género y antes de desplegar este frontend.

Administración incorpora filtros combinables en servidor, contador global, paginación, sumatoria de prendas y exportación XLSX SIDIGE con una fila por prenda. CSV permanece disponible y respeta los mismos filtros. Ejecuta la migración pendiente `202609020002_admin_sidige.sql` antes de desplegar esta versión; añade solo funciones de lectura con control admin, sin cambiar tablas ni RLS.

Consulta [la guía de Administración y SIDIGE](docs/administracion-sidige.md) para el contrato de Excel, seguridad, despliegue y pruebas. `npm test` ejecuta las pruebas de datos y endpoints; `npm run test:ui` prueba los componentes en un entorno visual aislado.

## Roles y edición de prendas

Desde el detalle, “Editar prendas” permite modificar el conjunto solicitado sin editar agente, destino ni cabecera. Cantidad fija desde el maestro; precio/código históricos para líneas conservadas. Retirar y volver a agregar crea otra línea activa con los valores actuales. Atendido bloquea a ambos roles. Ver [migraciones, conservación del historial y validaciones](docs/roles-edicion-baja-logica.md).

## Seguridad antes de producción

Revisar [SECURITY_AUDIT.md](SECURITY_AUDIT.md), aplicar la migración de seguridad pendiente y completar su checklist. Confirmar en Supabase que signup público y usuarios anónimos estén deshabilitados. Las verificaciones locales no certifican el Dashboard ni GitHub remotos. Usar HTTPS en producción y `npm ci` para instalar las versiones del lockfile.

La [revisión de los seis avisos de Supabase](docs/security-advisor.md) explica cuáles aceptar, la fachada compatible `public.is_admin()`/helper privado de 006 y la protección de contraseñas según plan. `supabase/inspection/security-advisor.sql` permite comparar la configuración real mediante consultas de solo lectura. No se trasladó `pg_trgm` ni se aplicaron migraciones remotamente durante esta revisión.
