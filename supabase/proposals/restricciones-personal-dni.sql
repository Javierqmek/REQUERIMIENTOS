-- PROPUESTA (NO es una migración, NO ejecutar todavía): restricciones de DNI en public.personal.
-- Aplicar SOLO después de fusionar los duplicados y de corregir los DNI que no tengan 8 dígitos
-- (supabase/inspection/dni-duplicados-personal.sql, consultas 2 a 4 deben dar 0 filas). Una sola ejecución.
begin;

-- 1. Todo DNI debe tener exactamente 8 dígitos. NOT VALID: se exige ya a lo nuevo y a lo que se edite; luego se valida lo existente
--    (falla con el primer registro inválido si queda alguno: corregirlo y repetir).
alter table public.personal add constraint personal_dni_8_digitos check (dni ~ '^[0-9]{8}$') not valid;
alter table public.personal validate constraint personal_dni_8_digitos;

-- 2. Un solo registro ACTIVO por DNI. Parcial a propósito: el duplicado desactivado por la fusión conserva su DNI (historial)
--    sin bloquear, y reactivarlo mientras exista otro activo falla en vez de recrear el duplicado.
create unique index personal_dni_activo_uidx on public.personal (dni) where activo;

commit;

-- Para revertir: drop index public.personal_dni_activo_uidx; alter table public.personal drop constraint personal_dni_8_digitos;
