import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { makeRetryStorageCleanupHandler } from "@/lib/vacations/handlers";

const handler = makeRetryStorageCleanupHandler({ getProfile: getCurrentProfile, getDb: createClient });
export async function POST(request: Request) {
  return handler(request);
}
