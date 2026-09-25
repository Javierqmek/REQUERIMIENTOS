-- Antes de activar "Allow new users to sign up" (necesario para que funcione el botón de
-- Google), toda cuenta de Auth nueva debe recibir 'sin_vincular' -- sin importar el proveedor.
-- Antes de esta migración, handle_new_user() solo daba 'sin_vincular' a cuentas de Google
-- (raw_app_meta_data->>'provider'='google'); cualquier otra cuenta nueva (incluido un registro
-- público por correo+contraseña vía la API pública, que ese interruptor global también habilita)
-- heredaba el default de la columna ('coordinador', el viejo 'supervisor' renombrado), con acceso
-- real al panel. Ahora el default es 'sin_vincular' para TODA cuenta nueva, sin excepción.
--
-- Consecuencia directa: admin/coordinador/gerente/capacitador YA NO se pueden dejar en su rol
-- por default al crear la cuenta -- hay que asignarlo explícitamente con un UPDATE después de
-- crearla (ver README.md, sección 5, actualizada en el mismo commit que esta migración).
begin;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, nombre, role)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'nombre', split_part(coalesce(new.email,''), '@', 1)), 'sin_vincular');
  return new;
end;
$$;

notify pgrst,'reload schema';
commit;
