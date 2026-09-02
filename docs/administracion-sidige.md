# Administración y exportación Excel SIDIGE

## Resultado

Administración incorpora filtros combinables en servidor, contador real, paginación de 50 registros, cantidad total de prendas y exportación XLSX SIDIGE. Se conserva la exportación CSV, ahora con los mismos filtros aplicados.

No se modifican tablas, columnas, datos, políticas RLS, autenticación, rutas de coordinador ni el flujo agente → cliente → unidad → prendas. Se añaden funciones SQL de lectura y endpoints administrativos autorizados por este cambio.

## Auditoría y decisiones de UI

Problemas anteriores:

- Búsqueda/estado solo filtraban las filas ya descargadas, no todo el universo.
- No había filtros de destino, coordinador o fechas ni contador global.
- La tabla tenía ancho mínimo de 900 px, obligando a desplazar horizontalmente en móvil.
- El CSV no respetaba filtros; su estado de descarga se simulaba con un temporizador.
- No había exportación SIDIGE ni validación de datos incompletos.

Aplicación de corporate-product-ui:

- Se mantiene la paleta, tipografía, header y navegación actuales.
- Un único título de módulo; Excel SIDIGE es la acción principal, CSV secundaria.
- Filtros semánticos y compactos en tres columnas de escritorio, dos en tablet y una en móvil.
- Los filtros empiezan plegados si no hay criterios aplicados, para mostrar resultados inmediatamente. Con criterios presentes en URL, se abren.
- Tabla de ancho controlado en escritorio; filas informativas con etiquetas, estado y detalle en móvil. No hay scroll horizontal.
- Controles de 44–46 px, estados de carga estables, acciones deshabilitadas durante guardado/descarga y bloqueo de doble envío.
- Se estandarizan `AdminFiltersForm`, `AdminResults`, `StateControl` y `Toast`, reutilizando botones, inputs y Alert existentes.
- Alert recibe únicamente un ajuste de anchura/salto de texto para UUID y nombres de archivo largos en móvil.
- Éxito mediante toast y confirmación persistente del archivo; error con requerimientos identificados y enlaces al detalle.

## Filtros, listado y paginación

Los siete criterios (seis solicitados más la búsqueda conservada) comparten validación:

- Cliente: `requerimientos.cliente_id`.
- Unidad / Sede: `requerimientos.unidad_id`. Al cambiar cliente se limpia la unidad. Sin cliente seleccionado se ofrecen todas las unidades; con cliente se restringen a ese cliente.
- Coordinador: `usuario_creador_id → profiles.id`. Solo se ofrecen usuarios que han creado requerimientos, incluidos administradores si también registraron solicitudes.
- Estado: Pendiente, Atendido u Observado.
- Fecha desde / hasta: zona horaria de Perú. “Hasta” incluye todo el día usando como límite exclusivo la medianoche siguiente.
- Búsqueda: agente, DNI, cliente, unidad, nombre/email del coordinador. Se aplica en servidor a todo el conjunto, no solo a la página.

Clientes/unidades de filtros incluyen catálogos inactivos, necesarios para consultar el historial. No se cambia el selector de creación del coordinador, que sigue usando activos.

“Aplicar filtros” consulta el conjunto completo y vuelve a página 1; “Limpiar filtros” restablece todos. Mientras hay cambios sin aplicar, las exportaciones se deshabilitan para evitar ambigüedad. La URL conserva criterios y página para recargar o compartir la vista.

Cantidad de prendas = suma de `detalle_requerimiento.cantidad`, no cantidad de renglones ni cantidad actual del maestro. Cambiar estado mantiene la misma operación permitida y vuelve a calcular página/contador: si había filtro de estado, el registro puede salir del listado.

## SQL a ejecutar en Supabase

Nueva migración:

`supabase/migrations/202609020002_admin_sidige.sql`

En una instalación existente con las migraciones anteriores aplicadas, ejecuta únicamente ese archivo completo en SQL Editor, una sola vez, antes de desplegar el frontend.

Orden completo para una instalación nueva:

1. `202608170001_initial_schema.sql`
2. `202608170002_performance.sql`
3. `202609020001_clientes_unidades_cantidad.sql`
4. `202609020002_admin_sidige.sql`

No vuelvas a ejecutar las migraciones anteriores en un proyecto donde ya estén aplicadas. No se necesita importar datos nuevos para este módulo ni ejecutar seed.

La migración añade:

- `admin_opciones_requerimientos()`: devuelve clientes, unidades y coordinadores con requerimientos.
- `admin_consultar_requerimientos(...)`: filtra, cuenta y pagina. Devuelve solo datos compactos para listado; en modo exportación incorpora detalles ordenados y valores históricos.

Ambas son `SECURITY INVOKER`, comprueban usuario y `is_admin()`, mantienen la aplicación de RLS y no conceden acceso a anon/PUBLIC. Un coordinador no puede invocarlas para obtener datos administrativos. No se añade ni elimina ninguna política.

La migración está probada en PostgreSQL aislado, pero **no se ejecutó en tu Supabase remoto**. Tras aplicarla, verifica una sesión admin y una de coordinador en tu entorno de pruebas.

## Endpoints

- `GET /api/admin/requerimientos`: listado filtrado y contador.
- `PATCH /api/admin/requerimientos`: solo acepta UUID y estado; rechaza campos adicionales.
- `GET /api/admin/requerimientos/sidige`: XLSX SIDIGE.
- `GET /api/admin/requerimientos/csv`: conserva CSV y columnas anteriores.

Los endpoints comprueban `profile.role === "admin"` en servidor. No se usa service_role. Los datos se consultan con la sesión normal y RLS. La página también conserva su comprobación admin.

Parámetros compartidos: `cliente, unidad, coordinador, estado, desde, hasta, q`. `page` afecta al listado; las exportaciones recorren todos los resultados de esos filtros, no solo la página.

Si la sesión caduca y el middleware redirige al login, el cliente detecta redirección/HTML y muestra un aviso: nunca descarga ese HTML como XLSX.

## Contrato SIDIGE

Una hoja llamada SIDIGE. Primera fila con estos diez encabezados exactos, sin títulos, logos, totales, filtros ni celdas combinadas.

| Columna | Origen y regla | Tipo |
| --- | --- | --- |
| Comentario | Cargo + nombre completo + DNI, trim y espacios simples | Texto |
| Ref.Int. | Siempre RENOVACION VERANO, incluso con referencia histórica distinta | Texto |
| Num. Real | Nombre de cliente + nombre de unidad separados por un espacio | Texto |
| Glosa | Exactamente igual a Comentario | Texto |
| Num. Item | 1…N dentro de cada requerimiento; reinicia en 1 | Entero |
| Sub. Alm. | Código de almacén del detalle; fallback al maestro solo si no existe, trim | Texto |
| Cod. Articulo | Código de prenda, preservando ceros e interior del código | Texto |
| Des. Articulo | Nombre de prenda | Texto |
| Cantidad Art. | Cantidad registrada en el detalle | Entero |
| Precio Art. | Precio unitario registrado en el detalle | Número, formato 0.00 |

Una fila por prenda del requerimiento. Orden de requerimientos por fecha/id descendentes; detalles por created_at/id ascendentes. La transformación conserva los microsegundos de PostgreSQL para el desempate temporal.

No se sustituye el precio histórico por el precio actual ni la cantidad histórica por la cantidad del maestro. Precio cero es válido. Los textos se escriben como texto, nunca como fórmulas, incluso si un código empieza por “=”.

Nombre: `MIGRADOR_RENOVACION_VERANO_YYYYMMDD_HHmm.xlsx`, con fecha/hora de Perú.

Se utiliza [ExcelJS](https://github.com/exceljs/exceljs#streaming-xlsx), solamente en servidor. El escritor confirma las filas progresivamente y mantiene en memoria el archivo comprimido final, no todas las filas/celdas del libro.

## Validación de exportación

Se exige agente, DNI, cargo, cliente, unidad, código/descripción de prenda, código de almacén, cantidad positiva entera y precio numérico no negativo. Se verifica también orden identificable y límites de texto de Excel.

- Datos incompletos: HTTP 422 con UUID, agente y campos faltantes. El administrador ve enlaces al detalle.
- Se informan hasta 20 requerimientos en el mensaje y el total de incompletos; permite acotar filtros para revisar el resto.
- No se entrega ningún archivo parcial si alguna fila falla.
- Sin resultados: “No hay requerimientos para exportar con los filtros seleccionados.”
- Se respeta el máximo de filas de una hoja Excel; si se excede, no se entrega un archivo truncado.

No se corrigen datos históricos automáticamente. Un historial sin destino conocido puede consultarse, pero se bloquea su exportación SIDIGE hasta completar los datos mediante el procedimiento administrativo autorizado.

## Rendimiento

- Opciones y primera página se consultan en paralelo.
- Página administrativa: 50 cabeceras, con sumatoria calculada en SQL; no se envían detalles al navegador.
- Catálogos/coordinadores se obtienen como opciones, sin descargar todas las cabeceras.
- Exportaciones: bloques de 250 requerimientos con sus relaciones en una consulta por bloque, sin N+1 de red.
- La exportación usa cursor fecha/id y un corte de created_at al inicio; excluye nuevas solicitudes creadas durante la descarga.
- Los índices existentes de creador, cliente, unidad, fecha, estado y detalle siguen utilizándose; no se crean duplicados.
- No hay una transacción global entre bloques: cambios administrativos concurrentes que alteren los filtros pueden afectar la pertenencia de registros durante una exportación prolongada. Para un cierre operativo, evita cambios de estado mientras se genera el archivo.
- El archivo comprimido final sigue necesitando memoria y la ejecución está sujeta al tiempo permitido por el hosting. Conviene acotar fechas en exportaciones grandes.

## Pruebas y verificaciones

Ejecutado:

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test`: 38 pruebas de transformación, archivo XLSX leído de vuelta, tipos numéricos, precio 0.00, tildes, ceros, códigos, snapshots, orden, filtros, endpoints y paginación.
- `supabase/tests/admin-sidige.sql`: pruebas SQL con ROLLBACK para filtros individuales/combinados, fechas, opciones, cantidades, cursor y rechazo admin/coordinador/anon. Ejecutadas sobre PostgreSQL 18 temporal con Auth mínimo de prueba.
- `npm run test:ui`: 12 pruebas visuales/interactivas aisladas con componentes reales y datos ficticios. No conectan a Supabase.
- `npm audit --omit=dev`: cero vulnerabilidades. Se fijó UUID 11.1.1 bajo ExcelJS mediante override para eliminar el aviso de la dependencia anterior.

Viewports revisados visualmente: 1440×900, 1366×768, 390×844, 375×812, 320×700. Se comprobó ausencia de desbordamiento horizontal, nombres largos, teclado del menú de usuario, filtros, paginación, carga, descarga, éxito, vacío, errores e intento de descarga con sesión caducada. Las capturas se generan en `.qa/`, ignorado por Git.

Para repetir en Windows con Edge instalado:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:ui
```

En un entorno con Chromium de Playwright instalado, basta `npm run test:ui` sin ese override.

El servidor de pruebas vive en `tests/visual/server.ts`, escucha exclusivamente en 127.0.0.1:3099 y usa fixtures; no hay rutas QA ni bypass de autenticación dentro de la aplicación Next.js.

Pendiente de integración remota: aplicar la migración y verificar Auth/PostgREST del proyecto Supabase real y la aceptación del archivo por el migrador SIDIGE instalado. El contrato XLSX y sus tipos se probaron, pero no se tuvo acceso al migrador externo.
