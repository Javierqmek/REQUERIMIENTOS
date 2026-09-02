-- Renombra el valor del enum, conservando OID, perfiles, permisos y defaults.
begin;
alter type public.user_role rename value 'supervisor' to 'coordinador';
notify pgrst, 'reload schema';
commit;
