import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EditRequirement } from "@/components/edit-requirement";
import type { EditPayload } from "@/lib/requirements/edit";

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const db = await createClient();
  const { data, error } = await db.rpc("obtener_edicion_prendas", { p_id: id });
  if (error?.code === "42501" || (!error && !data)) notFound();
  if (error) throw new Error("No pudimos cargar la edición de prendas.");
  return <EditRequirement initial={data as EditPayload} profile={profile}/>;
}
