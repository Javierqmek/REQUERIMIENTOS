-- SOLO LECTURA. Ejecutar en el SQL Editor de Supabase (no modifica nada).
-- Consulta 1: cada registro de personal cuyo DNI aparece más de una vez, con lo que hay que saber para elegir cuál conservar.
--   vinculado = tiene cuenta (profile_id); requerimientos = requerimientos.agente_id; documentos = documentos.trabajador_id;
--   papeletas = papeletas_vacaciones (colaborador_id o reemplazo_id) y sus versiones;
--   capacitaciones = filas de capacitacion_progreso y examen_intentos del perfil vinculado (agente_id referencia a profiles,
--   por eso un registro sin cuenta siempre muestra 0).
select p.dni, p.codigo_personal, p.nombre, p.activo,
       (p.profile_id is not null) as vinculado, p.email, p.cliente_actual_id,
       (select count(*) from public.requerimientos r where r.agente_id = p.id) as requerimientos,
       (select count(*) from public.documentos d where d.trabajador_id = p.id) as documentos,
       (select count(*) from public.papeletas_vacaciones v where p.id in (v.colaborador_id, v.reemplazo_id)) as papeletas,
       (select count(*) from public.papeletas_vacaciones_versiones v where p.id in (v.colaborador_id, v.reemplazo_id)) as papeletas_versiones,
       (select count(*) from public.capacitacion_progreso c where c.agente_id = p.profile_id) as capacitacion_progreso,
       (select count(*) from public.examen_intentos e where e.agente_id = p.profile_id) as examenes,
       p.created_at, p.id
from public.personal p
where p.dni in (select dni from public.personal group by dni having count(*) > 1)
order by p.dni, p.activo desc, p.codigo_personal;

-- Consulta 2: cuántos DNI no cumplen ^[0-9]{8}$ (el resumen, por motivo).
select count(*) as registros_con_dni_invalido,
       count(*) filter (where dni ~ '^[0-9]+$' and length(dni) < 8) as menos_de_8_digitos,
       count(*) filter (where dni ~ '^[0-9]+$' and length(dni) > 8) as mas_de_8_digitos,
       count(*) filter (where dni !~ '^[0-9]+$') as con_letras_o_simbolos_o_espacios
from public.personal
where dni !~ '^[0-9]{8}$';

-- Consulta 3: el detalle de esos registros.
select codigo_personal, nombre, '[' || dni || ']' as dni_tal_como_esta, length(dni) as largo, activo, (profile_id is not null) as vinculado
from public.personal
where dni !~ '^[0-9]{8}$'
order by length(dni), codigo_personal;

-- Consulta 4: DNI duplicados que quedarían bloqueados por el índice único parcial (más de un registro ACTIVO con el mismo DNI).
select dni, count(*) as activos, array_agg(codigo_personal order by codigo_personal) as codigos
from public.personal where activo group by dni having count(*) > 1 order by dni;
