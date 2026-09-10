import type { EditPayload } from "../../lib/requirements/edit";
import type { Prenda, Profile } from "../../lib/types";
import { fixtureRequirement, IDS } from "./admin";

export const editProfile: Profile = { id: IDS.coordinador, nombre: "Javier Quispe", email: "qa@example.test", role: "coordinador" };
export const editGarments: Prenda[] = [
  { id: "33000000-0000-4000-8000-000000000001", codigo_prenda: "00001", nombre_prenda: "CAMISA OPERATIVA MANGA LARGA", genero: "HOMBRE", codigo_almacen: "ACTUAL", precio: 99, cantidad: 5, cliente: "RENIEC", activo: true },
  { id: "33000000-0000-4000-8000-000000000002", codigo_prenda: "00002", nombre_prenda: "PANTALÓN DE TRABAJO", genero: "AMBOS", codigo_almacen: "ALM-02", precio: 100, cantidad: 6, cliente: "RENIEC", activo: true },
  { id: "33000000-0000-4000-8000-000000000003", codigo_prenda: "00003", nombre_prenda: "BLUSA OPERATIVA", genero: "MUJER", codigo_almacen: "ALM-03", precio: 101, cantidad: 4, cliente: "RENIEC", activo: true },
];
export function fixtureEdit(): EditPayload {
  const row = fixtureRequirement();
  return { version: "a".repeat(32), requerimiento: { ...row,
    personal: { nombre: "MARÍA DE LOS ÁNGELES FERNÁNDEZ DEL CASTILLO", dni: "01234567", cargo: "AGENTE DE SEGURIDAD" },
    clientes: { nombre: "RENIEC" }, unidades: { nombre: "SEDE OPERACIONAL CON NOMBRE EXTENSO – LIMA" },
    detalle_requerimiento: [{ id: "73000000-0000-4000-8000-000000000001", prenda_id: editGarments[0].id, activo: true, cantidad: 2, precio_unitario: 20, codigo_almacen: "HISTÓRICO", prendas: editGarments[0] }],
  } };
}
