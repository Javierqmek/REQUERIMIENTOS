-- Roles nuevos para el módulo de Capacitaciones: 'agente' (capacitando, se autoregistra
-- validando DNI + código de personal) y 'capacitador' (sube contenido, arma exámenes, ve
-- reportes). Van en su PROPIA migración porque ALTER TYPE ... ADD VALUE no puede usarse en
-- la misma transacción en la que se agrega el valor (error 55P04) -- y tanto el SQL Editor de
-- Supabase como `supabase db push` envían cada archivo como un único lote, que Postgres trata
-- como una transacción implícita. 202609240001_capacitaciones.sql (que sí usa estos valores en
-- funciones y políticas) debe aplicarse DESPUÉS de que esta migración haya hecho commit.
alter type public.user_role add value if not exists 'agente';
alter type public.user_role add value if not exists 'capacitador';
