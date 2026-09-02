import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { makeSidigeHandler } from "@/lib/admin/handlers";

export const runtime = "nodejs";
export const maxDuration = 300;
export const GET = makeSidigeHandler({ getProfile: getCurrentProfile, getDb: createClient });
