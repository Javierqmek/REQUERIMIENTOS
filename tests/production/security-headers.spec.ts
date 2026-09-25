import { test, expect } from "@playwright/test";

// Corre contra el build de PRODUCCIÓN real (ver playwright.production.config.ts).

test("el HTML de producción no expone el nonce fuera de los atributos nonce= de sus propios script/link", async ({ request }) => {
  // Next.js SÍ pone el nonce real como atributo nonce="..." en cada <script>/<link> que renderiza
  // -- así funciona el CSP por nonce, es necesario y correcto, y el navegador ya lo protege por su
  // cuenta ("nonce hiding": element.getAttribute('nonce') devuelve vacío para JS que corra en la
  // página). Lo que NO debe pasar es que el valor quede en un lugar de LECTURA LIBRE fuera de ese
  // mecanismo -- como el <meta name="csp-nonce"> que se usaba antes para la prueba del reproductor
  // de YouTube, legible por cualquier inyección de HTML/CSS sin necesitar ejecutar script.
  for (const ruta of ["/login", "/registro", "/privacidad"]) {
    const response = await request.get(ruta);
    expect(response.ok(), `${ruta} debe responder 200 sin sesión (nunca redirigir a /login)`).toBe(true);
    const html = await response.text();
    expect(html, `${ruta} no debe contener un <meta name="csp-nonce">`).not.toContain("csp-nonce");
  }
});
