-- Restaura a service_role el acceso directo (sin RLS) a las tablas de "public" que perdió en
-- algún punto de la historia. Diagnóstico confirmado en producción: SELECT sobre public.personal
-- devolvía "permission denied for table personal" al llamar a
-- app/api/capacitaciones/registro/route.ts (el único lugar del código que hace una consulta
-- DIRECTA con el cliente service_role -- admin.from("personal").select(...) -- en vez de pasar por
-- una función SECURITY DEFINER; las funciones SECURITY DEFINER como vincular_agente() no dependen
-- de los grants de tabla de quien las llama, corren con los privilegios de su dueño, por eso ESA
-- parte del flujo sí funcionaba).
--
-- Por qué pasó: la única migración que revocó privilegios amplios sobre estas tablas es
-- 202609020005_seguridad_produccion.sql, con
--   revoke all on public.profiles,public.personal,... from public,anon,authenticated;
-- El literal "public" en el FROM no es la tabla, es el pseudo-rol PUBLIC de Postgres: TODO rol es
-- miembro implícito de PUBLIC, así que revocarle privilegios a PUBLIC se los quita a cualquier rol
-- que los tuviera solo por herencia de PUBLIC y nunca haya recibido un grant propio y directo.
-- service_role evidentemente dependía de PUBLIC para SELECT/INSERT/UPDATE/DELETE (de ahí que esos
-- cuatro desaparecieran), pero TRUNCATE/REFERENCES/TRIGGER sí eran un grant directo a service_role
-- (por eso esos tres sobrevivieron intactos). Esa migración después solo restauró acceso para
-- "authenticated" (grant select ... / grant insert,update ...), nunca para service_role -- porque
-- en ese momento ningún código de la app hacía consultas directas con service_role todavía; el
-- autoregistro de agentes de Capacitaciones fue el primero, y el hueco quedó expuesto recién ahí.
--
-- Reejecutar 202609020005 NO vuelve a romper esto: esa migración nunca nombra a service_role en su
-- REVOKE, así que no puede volver a quitarle lo que esta migración le otorga aquí de forma directa
-- (un grant directo a un rol nombrado no depende de -- ni es removido por -- revocarle algo a
-- PUBLIC). anon y authenticated NO reciben ningún permiso nuevo en esta migración: siguen
-- gobernados exclusivamente por RLS, exactamente como hasta ahora.
begin;

do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname='public' loop
    execute format('grant select,insert,update,delete on public.%I to service_role', r.tablename);
  end loop;
  for r in select sequencename from pg_sequences where schemaname='public' loop
    execute format('grant usage,select on sequence public.%I to service_role', r.sequencename);
  end loop;
end $$;

-- Para que las tablas/secuencias que se creen en el futuro también le den estos privilegios a
-- service_role sin depender de que cada migración nueva se acuerde de hacerlo explícitamente.
alter default privileges in schema public grant select,insert,update,delete on tables to service_role;
alter default privileges in schema public grant usage,select on sequences to service_role;

commit;
