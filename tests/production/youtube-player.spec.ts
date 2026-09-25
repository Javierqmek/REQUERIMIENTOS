import { test, expect } from "@playwright/test";

// Corre contra el build de PRODUCCIÓN real (ver playwright.production.config.ts: next build &&
// next start), no contra el servidor de pruebas aislado de tests/visual -- necesitamos las
// cabeceras reales que sirve el middleware (CSP con nonce real, sin mock alguno).
//
// Usa /login (pública, sin sesión) como documento anfitrión: comparte exactamente la misma CSP
// que cualquier otra página (lib/supabase/middleware.ts la genera igual para todas), así que sirve
// igual de bien que /capacitaciones/[id] para probar si el navegador deja crear el reproductor de
// YouTube -- sin necesitar una sesión real de Supabase. El video de prueba es un ID público
// cualquiera, válido en formato, nunca se muestra a ningún usuario real (test headless).
const VIDEO_ID_DE_PRUEBA = "dQw4w9WgXcQ";

test("el reproductor de YouTube carga sin errores de CSP ni de postMessage", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const response = await page.goto("/login");
  expect(response, "la página debe responder").not.toBeNull();
  const headers = response!.headers();

  const csp = headers["content-security-policy"];
  expect(csp, "la respuesta debe traer Content-Security-Policy").toBeTruthy();
  expect(csp).toContain("frame-src https://www.youtube-nocookie.com");
  expect(csp).toContain("i.ytimg.com");
  // COOP/COEP no están configurados a propósito: 'require-corp' (COEP) o 'same-origin' (COOP)
  // pueden romper el handshake de postMessage entre la página y un iframe de otro origen como
  // el del reproductor.
  expect(headers["cross-origin-embedder-policy"], "COEP no debe exigir require-corp").not.toBe("require-corp");
  expect(headers["cross-origin-opener-policy"]).toBeFalsy();

  const nonce = await page.locator('meta[name="csp-nonce"]').getAttribute("content");
  expect(nonce, "el layout debe exponer el nonce de esta petición").toBeTruthy();

  // Reproduce exactamente lo que hace components/capacitacion-video-player.tsx: inyecta el
  // script de la IFrame API con el nonce real (sin él, script-src con 'strict-dynamic' lo
  // bloquearía) y crea el player en modo privacidad, con origin=location.origin.
  const resultado = await page.evaluate(({ nonce, videoId }) => {
    return new Promise<{ ready: boolean; iframeSrc: string | null; erroresYt: string[] }>((resolve) => {
      const erroresYt: string[] = [];
      const container = document.createElement("div");
      container.id = "yt-test-container";
      document.body.appendChild(container);

      const finalizar = (ready: boolean) => {
        // YT.Player REEMPLAZA el div dado (no inserta el iframe adentro): buscar en todo el
        // documento el iframe que YouTube haya creado, no como descendiente del contenedor.
        const iframe = document.querySelector<HTMLIFrameElement>('iframe[src*="youtube-nocookie.com"]');
        resolve({ ready, iframeSrc: iframe?.getAttribute("src") ?? null, erroresYt });
      };
      const limite = setTimeout(() => finalizar(false), 15000);

      function crear() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new (window as any).YT.Player(container, {
          host: "https://www.youtube-nocookie.com",
          videoId,
          playerVars: { rel: 0, modestbranding: 1, iv_load_policy: 3, playsinline: 1, disablekb: 1, origin: window.location.origin },
          events: {
            onReady: () => { clearTimeout(limite); finalizar(true); },
            onError: (e: { data: number }) => { erroresYt.push(String(e.data)); },
          },
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window as any).YT?.Player) crear();
      else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).onYouTubeIframeAPIReady = crear;
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.nonce = nonce ?? "";
        script.onerror = () => finalizar(false);
        document.head.appendChild(script);
      }
    });
  }, { nonce, videoId: VIDEO_ID_DE_PRUEBA });

  expect(resultado.erroresYt, "sin errores reportados por el propio player de YouTube").toEqual([]);
  expect(resultado.iframeSrc, "el iframe debe apuntar a youtube-nocookie.com").toMatch(/^https:\/\/www\.youtube-nocookie\.com\//);
  expect(resultado.ready, "onReady debe disparar dentro de 15s (si no, el handshake está roto)").toBe(true);

  const erroresRelevantes = consoleErrors.filter(text =>
    /postMessage/i.test(text) || /content security policy/i.test(text) || /refused to (frame|load|connect)/i.test(text));
  expect(erroresRelevantes, `no debe haber errores de CSP ni de postMessage en consola:\n${erroresRelevantes.join("\n")}`).toEqual([]);
});
