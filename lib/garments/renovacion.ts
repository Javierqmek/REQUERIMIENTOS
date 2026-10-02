import { isGenderCompatible, type GarmentGender, type GenderChoice } from "./gender";

export const RENOVACIONES = ["VERANO", "INVIERNO"] as const;
export const PRENDA_RENOVACIONES = ["VERANO", "INVIERNO", "AMBOS"] as const;
export type Renovacion = (typeof RENOVACIONES)[number];
export type PrendaRenovacion = (typeof PRENDA_RENOVACIONES)[number];

export function isRenovacionCompatible(garment: PrendaRenovacion, choice: Renovacion) {
  return garment === "AMBOS" || garment === choice;
}

// Una prenda se ofrece si su renovación es la elegida (o AMBOS) y su género es el elegido (o AMBOS).
// Una dimensión sin elegir todavía (null) no excluye nada.
export function garmentFits(garment: { genero: GarmentGender; renovacion: PrendaRenovacion }, renovacion: Renovacion | null, gender: GenderChoice | null) {
  return (!renovacion || isRenovacionCompatible(garment.renovacion, renovacion)) && (!gender || isGenderCompatible(garment.genero, gender));
}

export function renovacionLabel(value: PrendaRenovacion) {
  return value === "AMBOS" ? "Ambos" : value === "VERANO" ? "Verano" : "Invierno";
}

// Importación: acepta Verano/INVIERNO/ambos sin importar mayúsculas ni tildes.
export function normalizeRenovacion(value: string | undefined): PrendaRenovacion | null {
  const text = (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
  return (PRENDA_RENOVACIONES as readonly string[]).includes(text) ? (text as PrendaRenovacion) : null;
}

// Prendas del catálogo que se pueden elegir y cuáles ya están en el requerimiento (no se repiten).
export function garmentChoices<T extends { id: string }>(garments: T[], addedIds: Iterable<string>) {
  const added = new Set(addedIds);
  return garments.map(garment => ({ garment, added: added.has(garment.id) }));
}
