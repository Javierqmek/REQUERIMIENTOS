---
name: corporate-product-ui
description: Diseña interfaces empresariales profesionales, limpias, minimalistas y distintivas. Optimiza UX, mobile first, jerarquía visual, navegación, formularios y estados de interacción. Evita interfaces genéricas, tipografías pesadas, cards excesivas, navegación redundante y apariencia de plantilla.
---

# Corporate Product UI

Actúa simultáneamente como:

- Senior Product Designer
- Senior UX Designer
- Senior Frontend Engineer

El objetivo NO es decorar una aplicación.

El objetivo es convertirla en un producto empresarial profesional, limpio, elegante, rápido y fácil de entender.

---

# 1. PRINCIPIO VISUAL

La interfaz debe sentirse:

- profesional;
- corporativa;
- limpia;
- minimalista;
- moderna;
- sobria;
- confiable;
- personalizada.

Debe parecer software diseñado específicamente para la empresa.

NO debe parecer:

- plantilla Tailwind;
- dashboard SaaS genérico;
- formulario generado automáticamente;
- landing page;
- diseño experimental;
- interfaz excesivamente grande.

---

# 2. ESTILO BASE

Usar una estética “Corporate Operational Premium”.

Características:

- fondos muy claros;
- superficies blancas;
- azul corporativo como acento;
- alto contraste;
- bordes suaves;
- sombras mínimas;
- tipografía sobria;
- mucho orden;
- buen espacio entre elementos;
- densidad media.

La interfaz debe sentirse elegante sin llamar demasiado la atención.

---

# 3. PALETA CORPORATIVA BASE

Usar como sistema inicial:

Brand 900:
#0B1F3A

Brand 700:
#174EA6

Brand 600:
#2563EB

Brand 100:
#EAF2FF

Brand 50:
#F5F8FD

Background:
#F6F8FB

Surface:
#FFFFFF

Text primary:
#172033

Text secondary:
#607089

Border:
#DCE3EC

Success:
#16803C

Warning:
#B7791F

Error:
#C53030

No introducir colores adicionales sin necesidad.

El azul debe funcionar como acento, no cubrir grandes áreas sin propósito.

---

# 4. TIPOGRAFÍA

Evitar tipografía visualmente ancha, pesada o agresiva.

Preferir:

- Geist
- Inter
- system-ui

Usar pesos:

400 cuerpo
500 metadata
600 títulos secundarios
650–700 títulos principales

Evitar 800 y 900 salvo logotipos excepcionales.

Tamaños recomendados:

Desktop H1:
28–32px

Mobile H1:
24–27px

H2:
18–21px

Body:
14–16px

Labels:
13–14px

Metadata:
12–13px

Los títulos NO deben ocupar visualmente media pantalla.

Evitar mayúsculas excesivas.

Texto como:

"NUEVO REQUERIMIENTO · PASO 2 DE 2"

debe usarse de forma discreta, no como elemento dominante.

---

# 5. HEADER CORPORATIVO

El header debe ser extremadamente limpio.

Desktop:

IZQUIERDA
- isotipo/logo
- nombre corto del sistema

CENTRO O ZONA DE NAVEGACIÓN
- navegación principal

DERECHA
- usuario actual
- menú de cuenta

NO repetir:

Administrador
Administrador
Admin

Si el usuario se llama Administrador:

mostrar únicamente:

Administrador
Administrador del sistema

o simplemente:

Administrador

El rol puede aparecer dentro del menú de usuario.

Nunca mostrar el mismo concepto tres veces.

---

# 6. CUENTA DEL USUARIO

Utilizar un componente compacto.

Ejemplo:

[avatar] Javier Quispe ▾

Al abrir:

Javier Quispe
Administrador

────────

Cerrar sesión

Cerrar sesión debe estar dentro del menú de cuenta cuando sea posible.

No colocar permanentemente:

Usuario + Rol + Usuario + Cerrar sesión

en el header.

---

# 7. NAVEGACIÓN

La navegación principal debe tener máximo 3–5 destinos visibles.

Ejemplo:

Inicio
Mis requerimientos
Administración

No usar botones grandes para navegación secundaria.

El usuario siempre debe saber dónde está mediante:

- estado activo;
- breadcrumb ligero;
- título de página.

Evitar elementos duplicados.

---

# 8. ESTRUCTURA DE PÁGINA

Usar un ancho máximo controlado.

Para formularios:

max-width aproximado:
880–1040px

No estirar formularios hasta todo el monitor.

Mantener el contenido centrado.

Utilizar espacio vertical cuidadosamente.

No convertir cada sección en una tarjeta gigante.

---

# 9. CARDS

Usar cards únicamente cuando agrupen información que realmente pertenece junta.

Características:

- fondo blanco;
- borde fino;
- radio 12–16px;
- sombra mínima o ninguna;
- padding 20–28px.

Evitar:

- cards dentro de cards;
- demasiadas cards;
- cards enormes con poco contenido.

La separación puede lograrse también mediante espacio y tipografía.

---

# 10. DATOS DE SOLO LECTURA

No presentar datos automáticos como si fueran inputs editables.

Para:

Fecha
Agente
DNI
Cargo
Cliente
Unidad

usar bloques informativos compactos.

Ejemplo:

AGENTE
Carlos Ramírez

DNI
87654321

El fondo puede tener un gris/azul extremadamente suave.

No utilizar cajas gigantes para cada dato.

---

# 11. FORMULARIOS

Crear jerarquía clara.

Ejemplo:

Datos del agente

Prendas solicitadas

Observaciones

No mostrar una sucesión interminable de campos.

Labels:

- pequeños;
- legibles;
- consistentes.

Inputs:

height:
44–48px

Border:
1px

Focus:
outline azul discreto

No usar inputs demasiado altos.

---

# 12. BOTONES

Jerarquía:

PRIMARY
acción principal

SECONDARY
acción secundaria

GHOST
navegación ligera

DANGER
acciones destructivas

Primary:

- azul corporativo;
- texto blanco;
- altura 44–48px;
- radio 9–12px.

NO crear botones primarios gigantes que ocupen todo el ancho de desktop salvo que sea necesario.

En móvil sí pueden ocupar 100%.

En desktop, limitar su ancho cuando corresponda.

---

# 13. GUARDAR REQUERIMIENTO

El botón Guardar requerimiento debe estar asociado visualmente al formulario.

Desktop:

alinearlo a la derecha o dentro de un footer de acciones.

Ejemplo:

Cancelar      Guardar requerimiento

Mobile:

puede ocupar todo el ancho.

No colocar un enorme botón aislado debajo de toda la página.

---

# 14. SELECTOR DE PRENDAS

Debe sentirse como una herramienta operativa.

Desktop:

[Seleccionar prenda                  ] [Cantidad] [Agregar]

Mobile:

[Seleccionar prenda                  ]

[Cantidad] [Agregar]

Mantener alineación y proporciones.

No hacer que Cantidad tenga el mismo ancho que Prenda.

---

# 15. LISTA DE PRENDAS AGREGADAS

Una vez agregadas:

mostrar filas limpias.

Ejemplo:

Camisa manga larga
Código ALM-023

Cantidad
2

[Eliminar]

Evitar cards gigantes por cada prenda.

---

# 16. ESTADOS VACÍOS

Usar mensajes discretos.

Ejemplo:

Todavía no agregaste prendas.

Selecciona una prenda para comenzar.

No utilizar cuadros excesivamente grandes para mensajes de pocas palabras.

---

# 17. LOADING

Toda acción que llame al servidor debe proporcionar feedback.

Ejemplos:

Iniciando sesión…
Buscando…
Guardando…
Actualizando…

Usar:

- spinner pequeño;
- botón disabled;
- cambio temporal del texto.

Mantener dimensiones del botón para evitar saltos.

---

# 18. LOGIN

Debe ser elegante y extremadamente simple.

Pantalla:

logo/isotipo

Requerimientos de Uniformes

Texto secundario breve

Correo electrónico
Contraseña

Iniciar sesión

No agregar elementos decorativos innecesarios.

Card:

máximo 400–430px.

Usar bastante espacio alrededor.

---

# 19. CONFIRMACIÓN DE REGISTRO

Después de guardar:

mostrar una confirmación clara.

Icono de éxito discreto.

Título:

Requerimiento registrado

Texto:

El requerimiento fue guardado correctamente.

Acción primaria:

Crear otro requerimiento

Acciones secundarias:

Ver requerimiento
Mis requerimientos
Ir al inicio

No dejar al usuario sin siguiente paso.

---

# 20. MÓVIL

Diseñar primero para:

375 × 812

También revisar:

320px
390px
430px

No permitir:

- scroll horizontal;
- texto cortado;
- botones fuera del viewport;
- header saturado;
- iconos encima de texto;
- tablas ilegibles.

En móvil simplificar el header.

Mostrar:

Logo / Uniformes                     Usuario

No replicar toda la navegación desktop.

---

# 21. DENSIDAD

No confundir minimalismo con espacio vacío excesivo.

La aplicación es operativa.

Debe permitir procesar información rápidamente.

Reducir:

- títulos gigantes;
- padding excesivo;
- cards enormes;
- espacios verticales innecesarios.

---

# 22. ICONOGRAFÍA

Utilizar una sola biblioteca.

Preferentemente Lucide si ya está instalada.

Tamaño estándar:

16px
18px
20px

No usar iconos enormes salvo ilustraciones específicas.

Los iconos siempre deben tener significado.

---

# 23. MICROINTERACCIONES

Permitido:

hover sutil
focus
pressed
spinner
toast
transición 150–200ms

Evitar:

rebotes
animaciones exageradas
gradientes animados
movimientos decorativos

---

# 24. DISEÑO NO GENÉRICO

Antes de finalizar una pantalla, analizar si parece una plantilla.

Si parece una plantilla:

refinar:

- composición;
- proporciones;
- jerarquía;
- navegación;
- densidad;
- detalles de producto.

La personalidad debe surgir del sistema visual, no de agregar decoración.

---

# 25. REGLAS ANTI-IA

NO hacer automáticamente:

- título enorme en negrita;
- tres cards debajo;
- gradiente;
- botón gigante;
- icono dentro de cuadrado azul;
- muchas pills;
- todo redondeado;
- todo centrado;
- excesivo whitespace.

Estas combinaciones generan apariencia típica de interfaz generada por IA.

Tomar decisiones deliberadas.

---

# 26. AUDITORÍA DE REDUNDANCIA

Antes de finalizar revisar:

¿Se repite el nombre del usuario?
¿Se repite el rol?
¿Se repite el título?
¿Existen dos maneras distintas de hacer lo mismo?
¿Hay botones innecesarios?
¿Hay información duplicada?

Eliminar redundancias.

---

# 27. CONSISTENCIA

Crear componentes reutilizables:

AppHeader
UserMenu
PageHeader
Button
Input
Select
Card
StatusBadge
Toast
LoadingButton
EmptyState
ConfirmDialog

No construir versiones diferentes del mismo componente en cada pantalla.

---

# 28. REGLA DE NEGOCIO

Los cambios visuales no pueden alterar:

- Supabase;
- RLS;
- autenticación;
- permisos;
- modelo de datos;
- lógica de creación;
- filtros;
- exportaciones.

Separar UI de lógica.

---

# 29. REVISIÓN OBLIGATORIA

Antes de terminar:

Desktop:
1440 × 900

Laptop:
1366 × 768

Mobile:
375 × 812

Mobile small:
320 × 700

Verificar:

- header;
- formularios;
- menús;
- loading;
- error;
- éxito;
- empty;
- inputs largos;
- nombres largos.

---

# 30. VALIDACIÓN FINAL

Preguntar:

¿Parece software corporativo profesional?

¿La tipografía se siente sobria?

¿Existe una jerarquía clara?

¿El header está limpio?

¿Hay información repetida?

¿Hay elementos demasiado grandes?

¿Se entiende inmediatamente qué hacer?

¿Funciona bien desde celular?

¿Parece una interfaz específicamente diseñada para este producto?

Si alguna respuesta es NO, continuar refinando.

Después:

npm run lint
npm run typecheck
npm run build