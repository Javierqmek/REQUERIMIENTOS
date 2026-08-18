# Requerimientos de Uniformes

Aplicación web para que supervisores registren solicitudes de prendas por agente y los administradores consulten, exporten y actualicen su estado. Es mobile-first y utiliza Next.js, TypeScript, Tailwind CSS y Supabase (PostgreSQL, Auth y Row Level Security).

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
3. Abre **SQL Editor**, pulsa **New query**, copia y ejecuta en orden todos los archivos de `supabase/migrations/`: primero `202608170001_initial_schema.sql` y después `202608170002_performance.sql`. Esto crea tablas, relaciones, validaciones, la transacción de guardado, políticas RLS e índices de rendimiento.
4. Crea otra consulta, copia `supabase/seed.sql` y pulsa **Run**. Esto carga los tres agentes y cuatro prendas de ejemplo.
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
2. Escribe correo y contraseña. Al crear el usuario, la migración genera automáticamente su perfil como supervisor.
3. Crea primero el usuario que será administrador.
4. Abre **SQL Editor** y ejecuta lo siguiente cambiando el correo:

```sql
update public.profiles
set role = 'admin', nombre = 'Administrador'
where email = 'administrador@empresa.com';
```

Los demás usuarios quedan como `supervisor`. Para cambiar el nombre visible de un supervisor puedes ejecutar el mismo `update`, sin modificar `role`.

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

## 7. Importar agentes y prendas reales

Prepara archivos CSV con encabezados equivalentes a las columnas de cada tabla. En Supabase abre **Table Editor**, entra a `personal` o `prendas` y usa **Insert > Import data from CSV**.

Para `personal` usa: `codigo_personal,nombre,dni,cargo,cliente,unidad,activo`. Para `prendas` usa: `codigo_prenda,nombre_prenda,codigo_almacen,precio,cliente,activo`.

No incluyas `id` ni `created_at`: Supabase los genera. Conserva DNI y códigos como texto; en Excel conviene asignar formato **Texto** antes de guardar el CSV. El valor de `cliente` debe coincidir exactamente entre agente y prenda, porque la aplicación solo muestra prendas del cliente del agente.

## 8. Desplegar en Vercel

1. Sube esta carpeta a un repositorio Git (GitHub, GitLab o Bitbucket).
2. En Vercel pulsa **Add New > Project**, importa el repositorio y deja detectado **Next.js**.
3. En **Environment Variables** agrega `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` con los mismos valores de `.env.local`.
4. Pulsa **Deploy**.
5. En Supabase abre **Authentication > URL Configuration**. Coloca la URL de Vercel como **Site URL** y agrégala a **Redirect URLs**. La autenticación por contraseña funciona de inmediato; esta preparación también facilita añadir magic link posteriormente.

## Seguridad incluida

- Toda ruta privada valida la sesión en servidor y middleware.
- RLS limita al supervisor a sus propios requerimientos y detalles.
- El administrador puede leer todo, pero solamente actualizar `estado`.
- El guardado usa una función PostgreSQL atómica: si falla un detalle, no queda una cabecera incompleta.
- Precio y código de almacén se copian al detalle para conservar el historial.
- La base valida cantidades positivas, prendas no repetidas y correspondencia de cliente.

## Rendimiento

- La búsqueda de agentes usa índices trigram y devuelve como máximo 20 coincidencias.
- Las búsquedas en curso se cancelan al seguir escribiendo, evitando respuestas duplicadas o fuera de orden.
- El catálogo de prendas se limita, selecciona solo columnas necesarias y se reutiliza por cliente durante el formulario.
- Los listados iniciales están acotados: 100 requerimientos propios y 50 filas administrativas, con carga incremental para consultar los siguientes bloques.
- El panel administrativo ya no descarga el detalle completo de prendas para renderizar la tabla.
- La exportación CSV se genera en el servidor en bloques de 500 registros, manteniendo RLS y autorización de administrador.
- Usuario y perfil se deduplican entre layouts y páginas durante el mismo render de servidor.
- La migración de rendimiento agrega índices para creador, agente, detalle, prenda, fecha, estado y búsqueda por nombre/DNI/código.

## Estructura principal

- `app/`: rutas y pantallas.
- `components/`: componentes interactivos reutilizables.
- `lib/`: Supabase, tipos y validaciones Zod.
- `supabase/migrations/`: esquema y políticas de seguridad.
- `supabase/seed.sql`: datos de prueba.
