import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { RegistroAgenteForm } from "@/components/registro-agente-form";

export default function RegistroPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#F6F8FB] p-5">
      <section className="card w-full max-w-[430px] p-6 sm:p-8">
        <div className="mb-7">
          <span className="mb-5 grid h-11 w-11 place-items-center rounded-lg bg-[#0B1F3A] text-white"><GraduationCap size={22} /></span>
          <h1 className="text-[22px] font-semibold tracking-[-.02em] text-[#0B1F3A]">Crea tu cuenta de Capacitaciones</h1>
          <p className="mt-1.5 text-sm text-[#607089]">Usa el DNI y código de personal con los que ya estás registrado en la empresa.</p>
        </div>
        <RegistroAgenteForm />
        <p className="mt-5 text-center text-sm text-[#607089]">¿Ya tienes cuenta? <Link href="/login" className="font-medium text-[#174EA6] hover:underline">Inicia sesión</Link></p>
      </section>
    </main>
  );
}
