# Auditoría Corporate Operational Premium

## Problemas detectados

- El header mezclaba administración, identidad, rol y cierre de sesión como acciones equivalentes y repetía información del usuario.
- Títulos `font-black`/`font-extrabold`, tamaños altos e iconos grandes daban apariencia de landing page.
- El inicio utilizaba tarjetas demasiado altas y decorativas para solo dos acciones operativas.
- Cada dato del agente se presentaba como una caja independiente, aumentando altura y fragmentando la lectura.
- El selector de prendas, el estado vacío y las filas agregadas ocupaban más espacio del necesario.
- Guardar requerimiento era un botón enorme aislado en desktop.
- Login usaba un gradiente y una composición más promocional que corporativa.
- Listados y administración tenían densidad y pesos tipográficos inconsistentes.

## Correcciones

- Header: marca a la izquierda, navegación central, un único control de cuenta a la derecha; nombre una vez, rol solo dentro del menú y cierre de sesión dentro del mismo.
- Tipografía: pila Geist/Inter/system, cuerpo 400–500, títulos 600–650 y escala máxima de 30 px.
- Paleta: tokens exactos Brand 900/700/600/100/50, Background, Surface, Border y colores semánticos.
- Superficies: bordes finos, radio de 12 px, sombra mínima y paddings de 16–20 px.
- Formularios: controles de 46 px, labels de 13 px y footer de acciones integrado.
- Datos del agente: rejilla compacta de solo lectura con divisores, sin una card por dato.
- Prendas: fila proporcional en desktop, selector más ancho, cantidad estrecha y filas simples con divisores.
- Responsive: acción primaria completa en móvil; navegación inferior compacta; cuenta reducida a avatar en móvil.

## Backend

No se modificaron Supabase, RLS, permisos, rutas, APIs, esquema, migraciones ni lógica de negocio.
