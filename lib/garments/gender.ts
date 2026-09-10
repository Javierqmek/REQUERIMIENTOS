export const GARMENT_GENDERS = ["HOMBRE", "MUJER", "AMBOS"] as const;
export type GarmentGender = (typeof GARMENT_GENDERS)[number];
export type GenderChoice = Exclude<GarmentGender, "AMBOS">;

export function isGenderCompatible(garment: GarmentGender, choice: GenderChoice) {
  return garment === "AMBOS" || garment === choice;
}

export function inferGender(genders: GarmentGender[]): GenderChoice | null {
  const specific = new Set(genders.filter((gender): gender is GenderChoice => gender !== "AMBOS"));
  return specific.size === 1 ? [...specific][0] : null;
}

export function genderLabel(gender: GarmentGender) {
  return gender === "AMBOS" ? "Unisex" : gender === "HOMBRE" ? "Hombre" : "Mujer";
}
