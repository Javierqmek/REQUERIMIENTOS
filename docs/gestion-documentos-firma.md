# Gestión de documentos y firma electrónica interna

## Alcance

El módulo es independiente de Requerimientos de Uniformes. Permite que un coordinador cargue un PDF, lo asigne a un gerente y consulte el resultado; el gerente asignado puede colocar su firma/sello, observar, rechazar o firmar. El administrador consulta todos los documentos y controla perfiles vigentes, pero no puede firmar por un gerente.

Se trata de una **firma electrónica interna**, no de una firma digital certificada.

## Modelo y seguridad

- perfiles_firma: versiones inmutables de firma y sello. Actualizar el perfil crea una versión nueva y no cambia documentos históricos.
- documentos: metadatos, estado, rutas privadas y hashes SHA-256 del original, de la versión opcional del coordinador y del PDF final.
- documento_firmas: página y coordenadas relativas (0–1) junto con la versión exacta del activo usado.
- documento_eventos: auditoría de creación, envío, posiciones, decisiones, firma y descargas.
- Rol agregado: gerente.
- Tipos: VACACIONES, LICENCIA_CON_GOCE y LICENCIA_SIN_GOCE.
- Estados: BORRADOR, PENDIENTE_FIRMA, OBSERVADO, FIRMADO, RECHAZADO.
- Bucket privado: documentos-firma; no hay URLs públicas.
- RLS queda habilitada y forzada. Las mutaciones se realizan mediante RPC con auth.uid(), rol, propietario/asignado y estado validados nuevamente en PostgreSQL.
- El original es inmutable. La firma opcional del coordinador genera una versión intermedia independiente; la firma del gerente genera el PDF final y conserva los tres hashes.
- Un token transaccional de cinco minutos evita confirmaciones concurrentes. Si la generación falla, se cancela; el estado no pasa a FIRMADO.

## Flujo

1. El coordinador busca un trabajador sin descargar el catálogo completo.
2. Selecciona tipo, gerente y PDF. El servidor verifica bytes reales, estructura, páginas, tamaño y nombre seguro.
3. El coordinador sigue el panel: **Guardar ubicación → Vista previa final → Firmar como coordinador (opcional) → Enviar a firma**.
4. Si firma, sus elementos se incrustan físicamente en una versión intermedia, se registra quién/cuándo firmó y el estado general permanece BORRADOR u OBSERVADO. Si no tiene perfil, la interfaz lo informa pero permite enviar sin firma.
5. El gerente recibe la versión intermedia cuando existe o el original cuando no existe. Sus colocaciones se aplican solo una vez sobre esa base.
6. El gerente sigue el panel: **Vista previa final → Observar/Rechazar → Firmar documento**. Observar/rechazar exige comentario.
7. Coordinador, gerente asignado y administrador pueden consultar lo que RLS permite y descargar el final.

## Experiencia de revisión y firma

- La firma y el sello se muestran con los mismos activos PNG versionados que usa el PDF final.
- Cualquier cambio de posición o tamaño invalida la revisión anterior. Firmar siempre exige coordenadas guardadas y una vista previa vigente; enviar sin firma también exige haber revisado la vista previa.
- Después de crear una versión intermedia o final, el visor cambia de PDF base y elimina las capas locales ya incrustadas para evitar duplicaciones visuales.
- “Firma + sello” utiliza un único activo compuesto y versionado (logo, firma, nombre y cargo). Así la firma manuscrita no se incrusta dos veces.
- El historial visible muestra solo creación, envío, observación, rechazo y firma. La trazabilidad completa conserva todos los eventos y agrupa visualmente las descargas repetidas.
- El sello nuevo es un PNG transparente de 900 × 340, sin fondo ni marco. Todo su perímetro conserva alfa cero y mantiene una plantilla compacta con logo, firma, nombre y cargo.
- PDF.js y la generación final usan la misma referencia visual. Las páginas con `/Rotate` 0, 90, 180 o 270 convierten las coordenadas relativas al espacio PDF antes de incrustar el activo; otras rotaciones se rechazan como incompatibles.
- “Vista previa final” llama a una ruta autenticada que genera el PDF real en servidor. En el gerente, esa ruta parte siempre de la versión del coordinador cuando existe; en caso contrario parte del original.

El repositorio todavía no contiene el logo oficial Seguroc. Mientras se entrega el PNG/SVG transparente se usa un wordmark tipográfico temporal. CorporateStampPreview acepta un logoSrc y makeCorporateStamp acepta un logoDataUri; al incorporar el activo oficial deben alimentarse ambos puntos con la misma versión para mantener la coincidencia entre preview y PDF.

## Instalación

Ejecutar en Supabase SQL Editor, en este orden:

1. Todas las migraciones existentes hasta 202609130001_admin_catalogos_crud.sql.
2. supabase/migrations/202609130002_documentos_firma.sql.
3. supabase/migrations/202609140001_firma_coordinador.sql.
4. supabase/migrations/202609140002_firma_evidencia.sql.

Si 202609130002 y 202609140001 ya fueron aplicadas, ejecute **solamente** la migración incremental `202609140002_firma_evidencia.sql`. Esta reemplaza de forma compatible las RPC de confirmación y descarga para registrar perfil/version, versión fuente, hashes previo/resultante, usuario, nombre, rol, cargo y hora de servidor. No vuelva a ejecutar ni edite migraciones aplicadas, no ejecute fragmentos aislados y no cambie el bucket a público. Ninguna migración fue ejecutada remotamente durante esta tarea.

Después:

1. Asigne role = gerente únicamente a los usuarios que firmarán.
2. Verifique en Storage que documentos-firma siga privado, con límite de 20 MiB y MIME PDF/PNG/WebP.
3. Confirme que las políticas de Storage para original, firmas, sellos, coordinador y firmado estén activas.
4. Verifique que RLS esté habilitada y forzada en perfiles_firma, documentos, documento_firmas y documento_eventos.
5. Pruebe con una cuenta coordinador y otra gerente reales antes de producción.
6. Cada usuario con un sello generado por una versión anterior debe volver a guardar su perfil una vez. Esto crea una versión inmutable nueva con el PNG transparente; los documentos históricos mantienen su activo original.

## Configuración

- DOCUMENT_MAX_BYTES: máximo de carga PDF en bytes. Valor predeterminado: 10 MiB; la base y el bucket limitan a 20 MiB.
- La plantilla de sello genera un PNG independiente con palabra institucional, nombre y cargo. Sustituya la palabra gráfica por el activo oficial si Marketing entrega uno, sin cambiar el flujo.

No se usan URLs públicas ni URLs firmadas en el MVP: el servidor descarga desde Storage con la sesión autenticada y RLS. Si más adelante se exponen URLs firmadas, deben tener expiración breve y emitirse solo después de repetir la autorización.

La migración incremental no requiere variables de entorno nuevas. Se conservan NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y el DOCUMENT_MAX_BYTES opcional.

## Build local en Windows

El script de producción usa next build --webpack. Es una opción soportada por Next.js 16 y no cambia rutas, Server Components, APIs ni comportamiento en ejecución. Se eligió porque, dentro de esta carpeta sincronizada por OneDrive, el antivirus interceptó un chunk con prefijo asw generado por Turbopack y dejó solamente su source map. Webpack completó el build desde cero. La salida se genera en `.next-build` para no reutilizar el `.next` que Windows/OneDrive dejó bloqueado; `next start` usa ese mismo directorio configurado. Para volver a Turbopack en otra máquina basta retirar `--webpack` del script build, después de confirmar que el antivirus no pone en cuarentena sus chunks.

## Pruebas manuales mínimas

- Coordinador crea borrador, coloca firma, envía y no puede firmar como gerente.
- Coordinador puede enviar sin firmar después de revisar el preview.
- Coordinador puede generar una versión intermedia; su firma queda registrada y sus colocaciones pasan a ser inmutables.
- Otro coordinador no puede leer ni mutar el documento.
- Gerente no asignado no puede leer, decidir ni firmar.
- Gerente asignado observa/rechaza solo con comentario.
- Doble solicitud de firma no produce dos finales confirmados.
- Fallo al generar/subir final deja el documento pendiente y libera el token.
- Original conserva hash/ruta; final tiene otra ruta/hash.
- El gerente usa la versión intermedia si existe y el original en caso contrario; el PDF final contiene ambas firmas sin duplicar la del coordinador.
- Perfil nuevo no altera colocaciones históricas.
- Documento firmado no admite cambios de colocación ni estado.
- Administrador ve documentos y perfiles, pero las RPC de firma lo rechazan.

## UX responsive

Las vistas usan los tokens Corporate Operational Premium existentes, componentes compartidos, controles táctiles y layouts que colapsan a una columna. Se validaron en 1440×900, 1366×768, 768×1024, 390×844, 375×812 y 320×700.

## Resultado local

- La cadena completa de 15 migraciones, incluida `202609140002_firma_evidencia.sql`, se aplicó sin errores en PostgreSQL 18 temporal.
- Las pruebas SQL locales confirmaron original/intermedia/final inmutables, descarga de la intermedia, evidencia completa de ambas firmas, perfil versionado, fuente correcta para el gerente, permisos EXECUTE mínimos y rechazo del coordinador al intentar confirmar como gerente.
- Se generó un PDF sintético de cuatro páginas con `/Rotate` 0/90/180/270, se incrustó el mismo sello mediante el código de producción y se renderizó con Poppler. El activo quedó legible, sin marco y en la misma ubicación visible en las cuatro páginas.
- El PDF real mencionado para la regresión no estaba presente en los adjuntos ni en el workspace; por eso la cobertura de orientación se realizó con casos sintéticos exhaustivos. Debe repetirse el mismo replay cuando se facilite ese archivo concreto.
- `npm run lint`, `npm run typecheck` y `npm run build` finalizaron correctamente.
- `npm test`: 121/121 pruebas aprobadas.
- `npm run test:ui`: 77/77 pruebas aprobadas, incluidas vista previa obligatoria, invalidación al mover, versión previa del coordinador y layouts responsive.

## Causas raíz corregidas

1. El generador histórico del sello dibujaba un `<rect>` redondeado con trazo negro dentro del propio PNG; quitar CSS no podía eliminarlo de versiones ya persistidas.
2. El visor respetaba `/Rotate`, pero la incrustación convertía coordenadas como si todas las páginas tuvieran rotación cero. En 90/180/270 cambiaban cuadrante y orientación.
3. La selección original/intermedia estaba repetida en varias rutas y la vista previa era una superposición de navegador. Ahora una única función resuelve la base y el preview usa el mismo generador físico que produce la versión firmada.
