import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { makeDeleteTestPapeletasHandler } from "@/lib/vacations/handlers";

const handler = makeDeleteTestPapeletasHandler({ getProfile: getCurrentProfile, getDb: createClient });
export async function POST(request: Request) {
  return handler(request);
}
