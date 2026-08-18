import { LoginForm } from "@/components/login-form";
import { Shirt } from "lucide-react";

export default function LoginPage() {
  return (
    <main className="min-h-screen grid place-items-center p-5 bg-gradient-to-br from-slate-50 to-blue-100">
      <section className="card w-full max-w-md p-7 sm:p-9">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-blue-600 text-white"><Shirt size={34} /></span>
          <h1 className="text-2xl font-extrabold tracking-tight">Requerimientos de Uniformes</h1>
          <p className="mt-2 text-sm text-slate-500">Ingresa con tu cuenta corporativa</p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
