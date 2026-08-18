import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Ingresa un correo válido"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
});

export const requerimientoSchema = z.object({
  agente_id: z.string().uuid(),
  detalles: z.array(z.object({
    prenda_id: z.string().uuid(),
    cantidad: z.number().int().positive("La cantidad debe ser mayor a cero"),
  })).min(1, "Agrega al menos una prenda").superRefine((rows, ctx) => {
    const ids = new Set<string>();
    rows.forEach((row, index) => {
      if (ids.has(row.prenda_id)) ctx.addIssue({ code: "custom", message: "No repitas una prenda", path: [index, "prenda_id"] });
      ids.add(row.prenda_id);
    });
  }),
});
