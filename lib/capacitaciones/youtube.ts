// Extrae el ID de video (11 caracteres) de un enlace de YouTube. Se usa tanto en el formulario
// del capacitador (validación inmediata) como en la API (nunca confía en lo que valide el
// navegador). Acepta youtube.com/watch?v=, youtu.be/, youtube.com/embed/ y /shorts/, con o sin
// protocolo, con o sin "www."/"m." y con parámetros adicionales (?si=, &t=, playlist, etc.).
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function extractYoutubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] || "";
    return VIDEO_ID_RE.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v") || "";
      return VIDEO_ID_RE.test(id) ? id : null;
    }
    const match = url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/);
    if (match && VIDEO_ID_RE.test(match[1])) return match[1];
  }
  return null;
}
