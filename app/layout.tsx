import type { Metadata } from "next";
import "./globals.css";
// Nonce por petición: no servir HTML estático con un nonce reutilizado.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Requerimientos de Uniformes",
  description: "Gestión de requerimientos de uniformes para agentes",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
