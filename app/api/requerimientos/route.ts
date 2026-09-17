import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getRequirementList } from "@/lib/requirements/list-data";
import { parseRequirementQuery } from "@/lib/requirements/list-filters";

export async function GET(request:Request){
  const profile=await getCurrentProfile();
  if(!profile||!["coordinador","admin"].includes(profile.role))return Response.json({error:"No autorizado"},{status:403});
  try{
    const {filters,page}=parseRequirementQuery(new URL(request.url).searchParams);
    return Response.json(await getRequirementList(await createClient(),filters,page,request.signal),{headers:{"Cache-Control":"private, no-store"}});
  }catch{
    return Response.json({error:"No se pudieron consultar los requerimientos."},{status:400,headers:{"Cache-Control":"private, no-store"}});
  }
}
