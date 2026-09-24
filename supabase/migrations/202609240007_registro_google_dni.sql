-- Reemplaza el autoregistro de agentes por correo+contraseña con Google + DNI: el agente entra
-- con su cuenta de Google (OAuth de Supabase Auth) y, si es la primera vez, vincula esa cuenta a
-- su fila de personal ingresando solo su DNI (ver app/api/capacitaciones/vincular/route.ts y
-- app/auth/callback/route.ts). Se retira vincular_agente(uuid,text,text) (dni+código+correo+
-- contraseña): nada vuelve a llamarla, el registro por correo+contraseña se quitó del navegador.
-- Requiere 202609240006_rol_sin_vincular.sql ya aplicada (con commit) antes que esta.
begin;

drop function if exists public.vincular_agente(uuid,text,text);

-- Cualquier cuenta de Auth nueva creada por Google OAuth recibe 'sin_vincular' en vez del
-- default de la columna ('coordinador', el viejo 'supervisor' renombrado) -- de lo contrario
-- entraría directo al panel principal sin haber vinculado nada. Las cuentas creadas de cualquier
-- otra forma (Admin API, ej. al crear un coordinador/gerente/admin) conservan el comportamiento
-- exacto de siempre: el default de la columna, sin tocar.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.raw_app_meta_data->>'provider' = 'google' then
    insert into public.profiles (id, email, nombre, role)
    values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'nombre', split_part(coalesce(new.email,''), '@', 1)), 'sin_vincular');
  else
    insert into public.profiles (id, email, nombre)
    values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'nombre', split_part(coalesce(new.email,''), '@', 1)));
  end if;
  return new;
end;
$$;

-- El usuario YA está autenticado con Google al llegar aquí (ver app/api/capacitaciones/vincular):
-- por eso usa auth.uid() -- nunca un id recibido del cliente -- para que nadie pueda vincular la
-- cuenta de otra persona pasando un id ajeno. El correo tampoco se recibe del cliente: se lee
-- directo de auth.users, así nadie puede guardar un correo falso en personal.email.
create function public.vincular_agente_google(p_dni text) returns public.personal
language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_personal public.personal; v_email text;
begin
  if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
  select email into v_email from auth.users where id=auth.uid();
  select * into v_personal from public.personal
    where dni=btrim(p_dni) and activo and profile_id is null
    for update;
  if not found then raise exception 'No se encontró un colaborador activo con ese DNI, o ya tiene una cuenta vinculada' using errcode='P0002'; end if;
  update public.profiles set role='agente', nombre=coalesce(nullif(v_personal.nombre,''),nombre) where id=auth.uid();
  update public.personal set profile_id=auth.uid(), email=coalesce(v_email,email) where id=v_personal.id returning * into v_personal;
  return v_personal;
end $$;
revoke all on function public.vincular_agente_google(text) from public,anon;
grant execute on function public.vincular_agente_google(text) to authenticated;

-- Desvincula una cuenta de Google de su fila de personal (corrige vinculaciones indebidas) y le
-- retira el rol agente -- solo admin, desde el panel (ver app/capacitaciones/gestion/agentes).
create function public.desvincular_agente(p_personal_id uuid) returns public.personal
language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_row public.personal; v_profile_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'No autorizado' using errcode='42501'; end if;
  select profile_id into v_profile_id from public.personal where id=p_personal_id for update;
  if not found then raise exception 'Colaborador no encontrado' using errcode='P0002'; end if;
  update public.personal set profile_id=null where id=p_personal_id returning * into v_row;
  if v_profile_id is not null then
    update public.profiles set role='sin_vincular' where id=v_profile_id and role='agente';
  end if;
  return v_row;
end $$;
revoke all on function public.desvincular_agente(uuid) from public,anon,authenticated;
grant execute on function public.desvincular_agente(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
