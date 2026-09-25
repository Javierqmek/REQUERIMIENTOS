import { redirect } from "next/navigation";
import Link from "next/link";
import { Shirt } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { VincularCuentaForm } from "@/components/vincular-cuenta-form";

export const dynamic = "force-dynamic";

export default async function VincularPage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role && profile.role !== "sin_vincular") {
    redirect(profile.role === "agente" || profile.role === "capacitador" ? "/capacitaciones" : "/inicio");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#F6F8FB] p-5">
      <section className="card w-full max-w-[410px] p-6 sm:p-8">
        <div className="mb-7">
          <span className="mb-5 grid h-11 w-11 place-items-center rounded-lg bg-[#0B1F3A] text-white"><Shirt size={22} /></span>
          <h1 className="text-[22px] font-semibold tracking-[-.02em] text-[#0B1F3A]">Vincula tu cuenta</h1>
          <p className="mt-1.5 text-sm text-[#607089]">Conectado como <strong>{user.email}</strong>. Ingresa tu DNI para asociarlo con tu registro de personal.</p>
        </div>
        <VincularCuentaForm />
        <p className="mt-4 text-center text-xs text-[#8794A8]"><Link href="/privacidad" className="hover:underline">Política de privacidad</Link></p>
      </section>
    </main>
  );
}
