import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";

function cell(value: unknown) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

export async function GET() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const supabase = await createClient();
  const pageSize = 500;
  let from = 0;
  const output: unknown[][] = [["Fecha","Supervisor","Agente","DNI","Cliente","Unidad","Estado","Prenda","Cantidad","Código almacén","Precio unitario"]];
  while (true) {
    const { data, error } = await supabase.from("requerimientos")
      .select("fecha,estado,personal(nombre,dni,cliente,unidad),profiles(nombre,email),detalle_requerimiento(cantidad,precio_unitario,codigo_almacen,prendas(nombre_prenda))")
      .order("fecha", { ascending: false }).range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: "No se pudo exportar" }, { status: 500 });
    for (const raw of data ?? []) {
      const row = raw as unknown as {fecha:string;estado:string;personal:{nombre:string;dni:string;cliente:string;unidad:string}|null;profiles:{nombre:string;email:string}|null;detalle_requerimiento:{cantidad:number;precio_unitario:number;codigo_almacen:string;prendas:{nombre_prenda:string}|null}[]};
      for (const detail of row.detalle_requerimiento) output.push([row.fecha,row.profiles?.nombre||row.profiles?.email,row.personal?.nombre,row.personal?.dni,row.personal?.cliente,row.personal?.unidad,row.estado,detail.prendas?.nombre_prenda,detail.cantidad,detail.codigo_almacen,detail.precio_unitario]);
    }
    if ((data?.length ?? 0) < pageSize) break;
    from += pageSize;
  }
  const csv = "\ufeff" + output.map(row => row.map(cell).join(";")).join("\r\n");
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="requerimientos-${new Date().toISOString().slice(0,10)}.csv"`, "Cache-Control": "private, no-store" } });
}
