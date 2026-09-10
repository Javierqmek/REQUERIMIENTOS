import type { GenderChoice } from "@/lib/garments/gender";

export function GarmentGenderPicker({ value, disabled, onChange }: {
  value: GenderChoice | null;
  disabled?: boolean;
  onChange: (value: GenderChoice) => void;
}) {
  return <fieldset disabled={disabled} className="mt-4 border-t border-[#E8EDF4] pt-4">
    <legend className="text-sm font-medium text-[#45556D]">¿Para quién son las prendas?</legend>
    <div className="mt-2 grid max-w-sm grid-cols-2 gap-2" role="radiogroup" aria-label="Género de las prendas">
      {(["HOMBRE", "MUJER"] as const).map(gender => <button
        key={gender} type="button" role="radio" aria-checked={value === gender}
        onClick={() => onChange(gender)}
        className={`gender-option ${value === gender ? "gender-option-active" : ""}`}
      >{gender === "HOMBRE" ? "Hombre" : "Mujer"}</button>)}
    </div>
    <p className="mt-2 text-xs text-[#607089]">Las prendas unisex aparecerán en ambas opciones.</p>
  </fieldset>;
}
