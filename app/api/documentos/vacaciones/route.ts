import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { makeRegisterPapeletaHandler } from "@/lib/vacations/handlers";

const handler = makeRegisterPapeletaHandler({ getProfile: getCurrentProfile, getDb: createClient });
export async function POST(request: Request) {
  return handler(request);
}
