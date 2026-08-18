import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Requerimientos de Uniformes",
  description: "Gestión de requerimientos de uniformes para agentes",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
