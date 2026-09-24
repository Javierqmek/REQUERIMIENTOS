import { redirect } from "next/navigation";
import { CapacitacionesShell } from "@/components/capacitaciones-shell";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";

export default async function CapacitacionesLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentCapacitacionProfile();
  if (!profile) redirect("/login");
  return <CapacitacionesShell profile={profile}>{children}</CapacitacionesShell>;
}
