import { z } from "zod";
import { validatePhysicalRange, validateSaleRange } from "./dates";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");

export const papeletaSchema = z.object({
  colaborador_id: z.string().uuid("Selecciona un colaborador"),
  reemplazo_id: z.string().uuid("Selecciona un reemplazo"),
  provincia_id: z.string().uuid("Selecciona una provincia"),
  cliente_id: z.string().uuid("Selecciona un cliente"),
  unidad_id: z.string().uuid("Selecciona una unidad"),
  fisicas_fecha_inicio: isoDate,
  fisicas_fecha_fin: isoDate,
  tiene_venta: z.boolean(),
  venta_fecha_inicio: isoDate.nullable(),
  venta_fecha_fin: isoDate.nullable(),
}).superRefine((value, ctx) => {
  if (value.reemplazo_id === value.colaborador_id) {
    ctx.addIssue({ code: "custom", message: "El reemplazo no puede ser el mismo colaborador que sale de vacaciones.", path: ["reemplazo_id"] });
  }
  const physicalError = validatePhysicalRange(value.fisicas_fecha_inicio, value.fisicas_fecha_fin);
  if (physicalError) ctx.addIssue({ code: "custom", message: physicalError, path: ["fisicas_fecha_fin"] });

  if (value.tiene_venta) {
    const saleError = validateSaleRange(true, value.fisicas_fecha_fin, value.venta_fecha_inicio ?? "", value.venta_fecha_fin ?? "");
    if (saleError) ctx.addIssue({ code: "custom", message: saleError, path: ["venta_fecha_inicio"] });
  } else if (value.venta_fecha_inicio || value.venta_fecha_fin) {
    ctx.addIssue({ code: "custom", message: "No se permiten fechas de venta sin activar la venta de vacaciones.", path: ["tiene_venta"] });
  }
});
