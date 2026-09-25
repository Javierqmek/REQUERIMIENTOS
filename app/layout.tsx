import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
// Nonce por petición: no servir HTML estático con un nonce reutilizado.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Requerimientos de Uniformes",
  description: "Gestión de requerimientos de uniformes para agentes",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce");
  // Expone el nonce de esta petición para código cliente que necesite inyectar un <script>
  // dinámico compatible con script-src (p.ej. la IFrame API de YouTube en
  // components/capacitacion-video-player.tsx) -- patrón recomendado por Next.js, no debilita la
  // CSP: el valor ya es conocido en el servidor, esto solo lo hace legible desde el navegador.
  return <html lang="es"><head>{nonce && <meta name="csp-nonce" content={nonce} />}</head><body>{children}</body></html>;
}
