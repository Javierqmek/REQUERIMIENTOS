import { RENOVACIONES, renovacionLabel, type Renovacion } from "@/lib/garments/renovacion";

export function RenovacionPicker({ value, disabled, onChange }: {
  value: Renovacion | null;
  disabled?: boolean;
  onChange: (value: Renovacion) => void;
}) {
  return <fieldset disabled={disabled} className="mt-4 border-t border-[#E8EDF4] pt-4">
    <legend className="text-sm font-medium text-[#45556D]">Tipo de renovación <span className="text-[#C53030]" aria-hidden="true">*</span></legend>
    <div className="mt-2 grid max-w-sm grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de renovación" aria-required="true">
      {RENOVACIONES.map(option => <button
        key={option} type="button" role="radio" aria-checked={value === option}
        onClick={() => onChange(option)}
        className={`gender-option ${value === option ? "gender-option-active" : ""}`}
      >{renovacionLabel(option)}</button>)}
    </div>
    <p className="mt-2 text-xs text-[#607089]">Las prendas marcadas como &ldquo;Ambos&rdquo; aparecen en las dos renovaciones.</p>
  </fieldset>;
}
