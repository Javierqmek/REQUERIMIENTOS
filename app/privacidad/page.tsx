import Link from "next/link";
import { ArrowLeft, Shirt } from "lucide-react";
import { CONTACTO_PRIVACIDAD, PRIVACIDAD_ULTIMA_ACTUALIZACION } from "@/lib/legal";

export const metadata = { title: "Política de privacidad" };

export default function PrivacidadPage() {
  return (
    <main className="min-h-screen bg-[#F6F8FB] p-5">
      <div className="mx-auto max-w-[640px] py-8 sm:py-12">
        <Link href="/login" className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-[#607089] hover:text-[#0B1F3A]"><ArrowLeft size={16} />Volver</Link>
        <section className="card p-6 sm:p-8">
          <span className="mb-5 grid h-11 w-11 place-items-center rounded-lg bg-[#0B1F3A] text-white"><Shirt size={22} /></span>
          <h1 className="text-[22px] font-semibold tracking-[-.02em] text-[#0B1F3A]">Política de privacidad</h1>
          <p className="mt-1.5 text-sm text-[#607089]">Plataforma de Capacitaciones de Seguroc</p>

          <div className="mt-6 grid gap-5 text-sm leading-relaxed text-[#334155]">
            <p>
              Esta política explica, en lenguaje sencillo, qué datos recogemos en la plataforma de
              capacitaciones de Seguroc, para qué los usamos y qué derechos tienes sobre ellos.
            </p>

            <div>
              <h2 className="text-[15px] font-semibold text-[#0B1F3A]">Qué datos recogemos</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Tu nombre y correo, de tu cuenta de Google al iniciar sesión.</li>
                <li>Tu DNI, para vincular tu cuenta con tu registro de personal.</li>
                <li>Tu avance en los videos de capacitación (qué porcentaje viste).</li>
                <li>Tus respuestas y notas en los exámenes de cada capacitación.</li>
              </ul>
            </div>

            <div>
              <h2 className="text-[15px] font-semibold text-[#0B1F3A]">Para qué los usamos</h2>
              <p className="mt-2">
                Únicamente para la capacitación interna del personal: llevar el registro de qué
                capacitaciones completaste y con qué resultado, verificar el cumplimiento de la
                empresa frente a sus clientes y normas, y comunicarnos contigo sobre tus
                capacitaciones pendientes o vencidas.
              </p>
            </div>

            <div>
              <h2 className="text-[15px] font-semibold text-[#0B1F3A]">Con quién los compartimos</h2>
              <p className="mt-2">
                Con nadie fuera de Seguroc. Tus datos se almacenan en los proveedores de
                infraestructura que usamos para operar la plataforma (Supabase, para la base de
                datos y el acceso, y Vercel, para el hospedaje web), únicamente como parte del
                funcionamiento técnico del servicio -- no los usan con ningún otro fin.
              </p>
            </div>

            <div>
              <h2 className="text-[15px] font-semibold text-[#0B1F3A]">Cuánto tiempo los conservamos</h2>
              <p className="mt-2">
                Mientras dure tu relación laboral con Seguroc, y el tiempo adicional que exija la
                normativa aplicable en materia laboral y de protección de datos.
              </p>
            </div>

            <div>
              <h2 className="text-[15px] font-semibold text-[#0B1F3A]">Tus derechos (ARCO)</h2>
              <p className="mt-2">
                Puedes solicitar en cualquier momento el <strong>acceso</strong>,{" "}
                <strong>rectificación</strong>, <strong>cancelación</strong> u{" "}
                <strong>oposición</strong> sobre tus datos personales, escribiendo a{" "}
                <a className="font-medium text-[#174EA6] hover:underline" href={`mailto:${CONTACTO_PRIVACIDAD}`}>{CONTACTO_PRIVACIDAD}</a>.
              </p>
            </div>

            <div>
              <h2 className="text-[15px] font-semibold text-[#0B1F3A]">Marco legal</h2>
              <p className="mt-2">
                Tratamos tus datos conforme a la Ley N.° 29733, Ley de Protección de Datos
                Personales del Perú, y su reglamento.
              </p>
            </div>

            <p className="border-t border-[#E3E9F1] pt-4 text-xs text-[#8794A8]">
              Última actualización: {PRIVACIDAD_ULTIMA_ACTUALIZACION}.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
