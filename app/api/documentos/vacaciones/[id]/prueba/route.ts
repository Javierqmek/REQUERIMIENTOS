import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { makeMarkTestPapeletaHandler } from "@/lib/vacations/handlers";

const handler = makeMarkTestPapeletaHandler({ getProfile: getCurrentProfile, getDb: createClient });
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(request, (await params).id);
}
