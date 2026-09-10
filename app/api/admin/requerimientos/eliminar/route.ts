import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { makeAdminDeleteHandler } from "@/lib/admin/handlers";

export const DELETE=makeAdminDeleteHandler({getProfile:getCurrentProfile,getDb:createClient});
