-- PROPUESTA (NO es una migración, NO ejecutar todavía): fusión segura de personal con DNI duplicado.
-- Usar solo cuando se haya elegido, para cada par, el registro que SE QUEDA. Ejecutar completo en una sola ejecución.
--
-- Qué hace por cada par (conservar, duplicado), identificados por codigo_personal:
--   * Pasa al registro que se queda: requerimientos.agente_id, documentos.trabajador_id y papeletas_vacaciones
--     (colaborador_id y reemplazo_id). NO cambia ningún otro dato de esas filas (fecha, estado, líneas, precios, etc.).
--   * Las capacitaciones y exámenes cuelgan de la CUENTA (profiles), no de personal: si el duplicado es el que tiene la
--     cuenta y el que se queda no, la vinculación (profile_id, email, cliente_actual_id) pasa al que se queda; con ella
--     van sus capacitaciones. Si AMBOS tienen cuenta, se detiene con error (decidir a mano).
--   * Desactiva el duplicado (activo=false); no borra nada, conserva su código y su DNI.
--   * Deja una fila de auditoría (DESACTIVAR) con lo que se movió.
--   * NO toca papeletas_vacaciones_versiones: son instantáneas históricas inmutables (trigger); siguen apuntando al
--     registro desactivado, que sigue existiendo.
--   * Si algo no cuadra al final (quedan referencias al duplicado o cambió el total de requerimientos) revierte todo.
begin;

-- Único cambio a una función existente: permitir cambiar SOLO agente_id durante la fusión (bandera de la transacción).
create or replace function public.proteger_requerimiento_actualizado() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.id is distinct from old.id or new.fecha is distinct from old.fecha
    or (new.agente_id is distinct from old.agente_id and pg_catalog.current_setting('app.fusion_personal', true) is distinct from 'on')
    or new.usuario_creador_id is distinct from old.usuario_creador_id
    or new.cliente_id is distinct from old.cliente_id
    or new.unidad_id is distinct from old.unidad_id
    or new.referencia_interna is distinct from old.referencia_interna
    or new.created_at is distinct from old.created_at then
    raise exception 'Solo se permite cambiar el estado';
  end if;
  return new;
end;
$$;

create function pg_temp.fusionar_personal(p_conservar text, p_duplicado text) returns text
language plpgsql as $$
declare
  k public.personal; d public.personal;
  n_req int; n_doc int; n_pap int; n_pap_r int; total_antes int; resto int;
begin
  select * into k from public.personal where codigo_personal = p_conservar for update;
  select * into d from public.personal where codigo_personal = p_duplicado for update;
  if k.id is null or d.id is null then raise exception 'No existe el código % o %', p_conservar, p_duplicado; end if;
  if k.id = d.id then raise exception 'Los dos códigos son el mismo registro'; end if;
  if k.dni is distinct from d.dni then raise exception 'Los DNI no coinciden (% vs %)', k.dni, d.dni; end if;
  if k.profile_id is not null and d.profile_id is not null then
    raise exception 'Ambos registros (% y %) están vinculados a una cuenta: resolver a mano', p_conservar, p_duplicado;
  end if;
  select count(*) into total_antes from public.requerimientos;

  -- La cuenta (y con ella sus capacitaciones) se queda con el registro conservado.
  if d.profile_id is not null then
    update public.personal set profile_id = null, email = null, cliente_actual_id = null where id = d.id;
    update public.personal set profile_id = d.profile_id, email = d.email, cliente_actual_id = d.cliente_actual_id where id = k.id;
  end if;

  perform pg_catalog.set_config('app.fusion_personal', 'on', true);
  update public.requerimientos set agente_id = k.id where agente_id = d.id;           get diagnostics n_req = row_count;
  perform pg_catalog.set_config('app.fusion_personal', 'off', true);
  update public.documentos set trabajador_id = k.id where trabajador_id = d.id;       get diagnostics n_doc = row_count;
  update public.papeletas_vacaciones set colaborador_id = k.id where colaborador_id = d.id; get diagnostics n_pap = row_count;
  update public.papeletas_vacaciones set reemplazo_id = k.id where reemplazo_id = d.id;     get diagnostics n_pap_r = row_count;

  update public.personal set activo = false where id = d.id;
  insert into private.admin_catalog_audit(usuario_id, accion, catalogo, registro_id, valores_antes, valores_despues)
  values (coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'), 'DESACTIVAR', 'personal', d.id,
    jsonb_build_object('codigo_personal', d.codigo_personal, 'nombre', d.nombre, 'dni', d.dni, 'activo', d.activo, 'vinculado', d.profile_id is not null),
    jsonb_build_object('fusionado_en', k.codigo_personal, 'requerimientos', n_req, 'documentos', n_doc, 'papeletas_colaborador', n_pap, 'papeletas_reemplazo', n_pap_r));

  select (select count(*) from public.requerimientos where agente_id = d.id) + (select count(*) from public.documentos where trabajador_id = d.id)
       + (select count(*) from public.papeletas_vacaciones where d.id in (colaborador_id, reemplazo_id)) into resto;
  if resto <> 0 then raise exception 'Quedaron % referencias al duplicado %', resto, p_duplicado; end if;
  if (select count(*) from public.requerimientos) <> total_antes then raise exception 'Cambió el total de requerimientos'; end if;
  return format('%s -> %s: %s requerimientos, %s documentos, %s+%s papeletas%s', p_duplicado, p_conservar, n_req, n_doc, n_pap, n_pap_r,
    case when d.profile_id is not null then ', cuenta transferida' else '' end);
end $$;

-- ===== COMPLETAR con la decisión de cada par: fusionar_personal('<código que SE QUEDA>', '<código duplicado a desactivar>') =====
-- select pg_temp.fusionar_personal('03',  '59');    -- DNI 25744847
-- select pg_temp.fusionar_personal('410', '414');   -- DNI 09476099
-- select pg_temp.fusionar_personal('79',  '171');   -- DNI 09465989
-- select pg_temp.fusionar_personal('88',  '130');   -- DNI 10623260
-- select pg_temp.fusionar_personal('117', '415');   -- DNI 25562809
-- select pg_temp.fusionar_personal('81',  '417');   -- DNI 10271414
-- (invertir el orden en cada línea si se prefiere conservar el otro)

commit;
