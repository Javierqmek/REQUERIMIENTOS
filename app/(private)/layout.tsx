import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentProfile } from "@/lib/auth";

export default async function PrivateLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?error=perfil");
  return <AppShell profile={profile}>{children}</AppShell>;
}
