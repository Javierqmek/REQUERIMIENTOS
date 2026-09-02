import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { makeAdminListHandler, makeAdminUpdateHandler } from "@/lib/admin/handlers";

const deps = { getProfile: getCurrentProfile, getDb: createClient };
export const GET = makeAdminListHandler(deps);
export const PATCH = makeAdminUpdateHandler(deps);
