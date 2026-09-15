# Auditoria de compatibilidad de navegador y sistema operativo

Fecha: 2026-09-14

## Resultado

La aplicacion define un baseline explicito, evita APIs ES2023/ES2024 sin fallback en codigo propio, usa el build legacy oficial de PDF.js y valida las superficies operativas en Chromium, Firefox y WebKit. No se modificaron contratos de negocio, Supabase, RLS, CSP ni permisos.

## Baseline de produccion

- Chrome / Chromium 109 o superior.
- Microsoft Edge 109 o superior.
- Firefox ESR 115 o superior.
- Safari macOS 15.6 o superior.
- Safari iOS / iPadOS 15.6 o superior.
- Android Chrome: motor equivalente a Chromium 109 o superior.

Next.js utiliza esta lista desde `package.json > browserslist.production`. El target TypeScript se mantiene en ES2017. PostCSS/Tailwind recibe el mismo contexto Browserslist durante el build.

## Matriz objetivo

| Plataforma | Navegadores | Cobertura | Condicion |
|---|---|---|---|
| Windows 8 / 8.1 | Chrome/Edge 109, Firefox ESR 115 | Best effort | El sistema operativo y esas ramas del navegador estan fuera de soporte de seguridad. Requiere prueba fisica corporativa. |
| Windows 10 | Chrome, Edge, Firefox desde el baseline | Compatible | Compilacion dirigida al baseline y pruebas Chromium/Firefox correctas. |
| Windows 11 | Chrome, Edge, Firefox desde el baseline | Compatible | Chromium representa el motor de Chrome/Edge; pruebas Firefox correctas. |
| Linux | Chromium/Chrome y Firefox desde el baseline | Compatible por motor | Falta certificacion en una distribucion fisica concreta. |
| macOS | Safari 15.6+, Chrome y Firefox | Compatible por motor | WebKit valida el motor; una prueba final en Safari fisico sigue siendo recomendable. |
| iOS / iPadOS | Safari 15.6+ | Compatible por motor y responsive | WebKit y viewports tactiles validados; no sustituye hardware real. |
| Android | Chrome/Chromium equivalente a 109+ | Compatible por motor y responsive | Viewports moviles validados; no sustituye hardware real ni WebView de fabricante. |

No se promete Safari en Windows, Edge Chromium moderno en un sistema que Microsoft ya no soporta, Internet Explorer, EdgeHTML, Android WebView antiguo ni navegadores embebidos propietarios.

## Hallazgos y correcciones

1. `Array.prototype.toReversed()` en el historial de documentos:
   - Reemplazado por copia inmutable con `.slice().reverse()`.
2. `String.prototype.replaceAll()` en UI de historial:
   - Reemplazado por `.split("_").join(" ")`.
3. PDF.js moderno:
   - El build moderno utiliza `Promise.withResolvers()`.
   - El visor y su worker ahora cargan `pdfjs-dist/legacy/build/*`, que incorpora traducciones/polyfills para navegadores anteriores.
4. `ResizeObserver`:
   - Se conserva cuando existe.
   - Si no existe, el visor usa `window.resize` con el mismo debounce.
5. Next.js:
   - Su target predeterminado era Chrome/Edge/Firefox 111 y Safari 16.4.
   - Se agrego Browserslist explicito para Chrome/Edge 109, Firefox 115 y Safari/iOS 15.6.
6. Overflow a 768 x 1024:
   - `AppShell` mostraba navegacion desktop desde 640 px.
   - Logo, cuatro enlaces y cuenta excedian 768 px.
   - La navegacion compacta se mantiene hasta 1023 px y la desktop comienza en 1024 px.
7. Pruebas multiengine:
   - Las fixtures mutables se aislaron por proyecto para que Chromium, Firefox y WebKit no compartan eliminaciones ni cambios de catalogo.

## APIs revisadas y conservadas

- `crypto.randomUUID()`: solo en servidor/middleware, no en componentes cliente.
- `URL.createObjectURL()`: soportada por el baseline; siempre se revoca.
- `AbortController`, `FormData`, `Blob`, `File`, canvas y Pointer Events: soportados por el baseline.
- Descarga mediante enlaces y Blob URL: compatible con el baseline; Safari iOS puede abrir el PDF en una vista previa antes de permitir guardarlo.
- PNG, WebP y PDF usan `input type=file`; no dependen de File System Access API ni drag and drop.
- La firma usa Pointer Events y `touch-action:none`, por lo que comparte el mismo flujo para mouse, lapiz y tactil.
- No se encontraron Clipboard API, Web Share API, File System Access API, OffscreenCanvas, createImageBitmap, DOMMatrix, IntersectionObserver ni AbortSignal.timeout en codigo cliente propio.

## CSS

No se encontraron `:has()`, container queries, subgrid, unidades `dvh/svh/lvh`, `color-mix()` ni `oklch()` en estilos propios. Se conservan Grid/Flexbox, `clamp()`, `aspect-ratio`, `:focus-visible` y `overflow-wrap:anywhere`, disponibles en el baseline definido. Las mejoras cosmeticas como blur no bloquean la operacion si el navegador las degrada.

## Pruebas preventivas

`tests/browser-compat.test.ts` bloquea:

- toReversed, toSorted, toSpliced y Array.with;
- findLast y findLastIndex;
- Array.fromAsync, Object.groupBy y Map.groupBy;
- structuredClone y Promise.withResolvers;
- AbortSignal.timeout y showOpenFilePicker;
- APIs cliente no aprobadas sin fallback;
- CSS fuera del baseline;
- regreso al build moderno de PDF.js;
- eliminacion del fallback de ResizeObserver;
- cambios accidentales del baseline Browserslist.

Los viewports estan centralizados en `tests/visual/viewports.ts`:

- 1440 x 900
- 1366 x 768
- 1024 x 768
- 768 x 1024
- 430 x 932
- 390 x 844
- 375 x 812
- 320 x 700

## Limitaciones reales

1. Windows 8/8.1 y sus ultimas ramas Chrome/Edge estan fuera de soporte de seguridad. Compatibilidad tecnica no equivale a una plataforma segura para produccion.
2. Playwright WebKit aproxima Safari, pero no reproduce todos los defectos de Safari/iOS ni el comportamiento de descarga del sistema operativo.
3. PDF.js mantiene un build legacy, pero su soporte oficial upstream para versiones antiguas puede ser mas estrecho que este baseline. Debe hacerse una prueba manual de aceptacion del visor, zoom, orientacion y firma en el navegador corporativo real.
4. La descarga en iOS puede abrir una vista previa nativa en vez de guardar inmediatamente; el archivo sigue siendo accesible mediante Compartir/Guardar en Archivos.
5. No se certificaron lectores de pantalla, WebViews integrados, navegadores administrados con JavaScript deshabilitado ni extensiones corporativas que alteren CSP/canvas.
6. Un sistema operativo fuera de soporte no debe recibir excepciones de CSP, TLS o seguridad para forzar compatibilidad.

## Validacion local

- ESLint: correcto.
- TypeScript: correcto.
- Pruebas estaticas/unitarias: 133/133.
- Build Next.js 16.3.1 con Webpack: correcto.
- Playwright: 324/324.
  - Chromium: 108/108.
  - Firefox: 108/108.
  - WebKit: 108/108.
