import Link from "next/link";
import { LoginForm } from "@/components/login-form";
import { Shirt } from "lucide-react";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#F6F8FB] p-5">
      <section className="card w-full max-w-[410px] p-6 sm:p-8">
        <div className="mb-7">
          <span className="mb-5 grid h-11 w-11 place-items-center rounded-lg bg-[#0B1F3A] text-white"><Shirt size={22} /></span>
          <h1 className="text-[22px] font-semibold tracking-[-.02em] text-[#0B1F3A]">Requerimientos de Uniformes</h1>
          <p className="mt-1.5 text-sm text-[#607089]">Ingresa con tu cuenta corporativa</p>
        </div>
        <LoginForm />
        <p className="mt-5 text-center text-sm text-[#607089]">¿Eres agente y no tienes cuenta de Capacitaciones? <Link href="/registro" className="font-medium text-[#174EA6] hover:underline">Regístrate aquí</Link></p>
      </section>
    </main>
  );
}
