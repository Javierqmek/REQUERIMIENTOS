-- Rol nuevo "superadmin": acceso total (todo lo que hoy tiene admin, más Documentos, Vacaciones/
-- Papeletas y Capacitaciones, que admin pierde). Necesita su PROPIA migración: un valor de enum
-- recién agregado no puede usarse en la misma transacción que lo agrega (error 55P04, ver
-- 202609240000_roles_capacitaciones.sql).
alter type public.user_role add value if not exists 'superadmin';
