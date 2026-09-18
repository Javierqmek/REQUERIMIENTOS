import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { makeReviewPapeletaHandler } from "@/lib/vacations/handlers";

const handler = makeReviewPapeletaHandler({ getProfile: getCurrentProfile, getDb: createClient });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(request, (await params).id);
}
