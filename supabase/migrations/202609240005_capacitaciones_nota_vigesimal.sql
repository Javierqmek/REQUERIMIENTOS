-- Cambia la calificación del examen a escala vigesimal (0 a 20), como se usa en Perú.
-- nota_minima pasa de significar "aciertos requeridos" a "nota mínima sobre 20"; se convierten
-- las capacitaciones existentes a la nueva escala en proporción a su número de preguntas
-- ACTUAL en este momento (si más adelante cambia el número de preguntas de una capacitación ya
-- convertida, el capacitador puede reajustar la nota mínima a mano -- ahora es editable en
-- cualquier momento mientras esté en borrador, ver /api/capacitaciones/[id]/nota-minima).
begin;

update public.capacitaciones c set nota_minima = least(20, greatest(0, round(
  case when (select count(*) from public.examen_preguntas q where q.capacitacion_id=c.id) > 0
    then (c.nota_minima::numeric / (select count(*) from public.examen_preguntas q where q.capacitacion_id=c.id)) * 20
    else 14 -- sin preguntas todavía: usa directamente el nuevo valor por defecto
  end
)))
where true;

alter table public.capacitaciones alter column nota_minima set default 14;
alter table public.capacitaciones drop constraint capacitaciones_nota_minima_check;
alter table public.capacitaciones add constraint capacitaciones_nota_minima_check check (nota_minima between 0 and 20);

-- Nota sobre 20 de cada intento, con 1 decimal. puntaje/total_preguntas/aprobado de intentos ya
-- existentes NO se recalculan (aprobado quedó fijado bajo la regla vigente cuando se rindió el
-- examen, es un registro histórico inmutable); nota es una columna nueva y se completa por cálculo
-- a partir de esos mismos valores ya guardados, solo para poder mostrarla también en la escala
-- nueva en el reporte.
alter table public.examen_intentos add column nota numeric(4,1);
update public.examen_intentos set nota = round((puntaje::numeric / total_preguntas) * 20, 1);
alter table public.examen_intentos alter column nota set not null;
alter table public.examen_intentos add constraint examen_intentos_nota_check check (nota between 0 and 20);

-- Publicar ya no exige nota_minima <= número de preguntas (no aplica en la escala vigesimal: el
-- check de tabla ya garantiza 0-20 sin importar cuándo se fijó el valor). Resto sin cambios.
create or replace function public.publicar_capacitacion(p_capacitacion_id uuid) returns public.capacitaciones
language plpgsql volatile security invoker set search_path=pg_catalog,public,pg_temp as $$
declare v_cap public.capacitaciones; v_preguntas integer; v_sin_correcta integer;
begin
  select * into v_cap from public.capacitaciones where id=p_capacitacion_id for update;
  if not found then raise exception 'Capacitación no encontrada' using errcode='P0002'; end if;
  if v_cap.video_path is null and v_cap.video_youtube_id is null then
    raise exception 'La capacitación necesita un video (subido o enlace de YouTube) antes de publicarse' using errcode='22023'; end if;
  select count(*) into v_preguntas from public.examen_preguntas where capacitacion_id=p_capacitacion_id;
  if v_preguntas<1 then raise exception 'La capacitación necesita al menos una pregunta de examen' using errcode='22023'; end if;
  select count(*) into v_sin_correcta from public.examen_preguntas q
    where q.capacitacion_id=p_capacitacion_id and not exists(select 1 from public.examen_opciones o where o.pregunta_id=q.id and o.es_correcta);
  if v_sin_correcta>0 then raise exception 'Todas las preguntas necesitan una opción correcta marcada' using errcode='22023'; end if;
  update public.capacitaciones set estado='PUBLICADA', updated_at=now() where id=p_capacitacion_id returning * into v_cap;
  return v_cap;
end $$;
revoke all on function public.publicar_capacitacion(uuid) from public,anon,authenticated;
grant execute on function public.publicar_capacitacion(uuid) to authenticated;

-- La nota se calcula SIEMPRE en el servidor: (aciertos / total de preguntas) * 20, redondeada a
-- 1 decimal. Con 1 pregunta vale 20; con 10 preguntas, cada una vale 2. aprobado ahora compara la
-- nota (no el conteo de aciertos) contra nota_minima, ambas ya en la escala 0-20.
create or replace function public.enviar_examen(p_capacitacion_id uuid, p_respuestas jsonb) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_intento_id uuid; v_numero integer; v_total integer; v_aciertos integer := 0; v_nota_minima integer;
  v_nota numeric(4,1); v_aprobado boolean; v_item jsonb; v_pregunta_id uuid; v_opcion_id uuid; v_correcta boolean;
begin
  if auth.uid() is null or not private.es_agente() then raise exception 'No autorizado' using errcode='42501'; end if;
  if not exists(select 1 from public.capacitaciones where id=p_capacitacion_id and estado='PUBLICADA') or not private.capacitacion_asignada_a_mi(p_capacitacion_id) then
    raise exception 'Capacitación no disponible' using errcode='P0002'; end if;
  if not coalesce((select video_completo from public.capacitacion_progreso where capacitacion_id=p_capacitacion_id and agente_id=auth.uid()),false) then
    raise exception 'Debes ver al menos el porcentaje mínimo del video antes de rendir el examen' using errcode='55000'; end if;
  select count(*) into v_total from public.examen_preguntas where capacitacion_id=p_capacitacion_id;
  if v_total<1 or jsonb_typeof(p_respuestas)<>'array' or jsonb_array_length(p_respuestas)<>v_total then
    raise exception 'Debes responder todas las preguntas' using errcode='22023'; end if;
  select nota_minima into v_nota_minima from public.capacitaciones where id=p_capacitacion_id;
  select coalesce(max(numero_intento),0)+1 into v_numero from public.examen_intentos where capacitacion_id=p_capacitacion_id and agente_id=auth.uid();
  insert into public.examen_intentos(capacitacion_id,agente_id,numero_intento,puntaje,total_preguntas,nota,aprobado)
  values (p_capacitacion_id,auth.uid(),v_numero,0,v_total,0,false) returning id into v_intento_id;
  for v_item in select * from jsonb_array_elements(p_respuestas) loop
    v_pregunta_id := nullif(v_item->>'pregunta_id','')::uuid; v_opcion_id := nullif(v_item->>'opcion_id','')::uuid;
    if not exists(select 1 from public.examen_preguntas where id=v_pregunta_id and capacitacion_id=p_capacitacion_id) then
      raise exception 'Pregunta inválida' using errcode='22023'; end if;
    v_correcta := coalesce((select o.es_correcta from public.examen_opciones o where o.id=v_opcion_id and o.pregunta_id=v_pregunta_id),false);
    if v_correcta then v_aciertos := v_aciertos+1; end if;
    insert into public.examen_intento_respuestas(intento_id,pregunta_id,opcion_id,correcta) values (v_intento_id,v_pregunta_id,v_opcion_id,v_correcta);
  end loop;
  v_nota := round((v_aciertos::numeric / v_total) * 20, 1);
  v_aprobado := v_nota >= v_nota_minima;
  update public.examen_intentos set puntaje=v_aciertos, nota=v_nota, aprobado=v_aprobado where id=v_intento_id;
  return jsonb_build_object('intento_id',v_intento_id,'aciertos',v_aciertos,'total',v_total,'nota',v_nota,'nota_minima',v_nota_minima,'aprobado',v_aprobado,'numero_intento',v_numero);
end $$;
revoke all on function public.enviar_examen(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.enviar_examen(uuid,jsonb) to authenticated;

-- El reporte ahora muestra la nota sobre 20 (antes mostraba el conteo crudo de aciertos).
create or replace function public.reporte_capacitacion(p_capacitacion_id uuid) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public,pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not (public.is_admin() or private.es_capacitador()) then raise exception 'No autorizado' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre),'[]'::jsonb) into v_result from (
    select per.id agente_personal_id, per.nombre, per.codigo_personal,
      coalesce(pr.porcentaje_visto,0) porcentaje_visto, coalesce(pr.video_completo,false) video_completo,
      (select count(*) from public.examen_intentos i where i.capacitacion_id=p_capacitacion_id and i.agente_id=per.profile_id) intentos,
      (select max(i.nota) from public.examen_intentos i where i.capacitacion_id=p_capacitacion_id and i.agente_id=per.profile_id) mejor_nota,
      (select bool_or(i.aprobado) from public.examen_intentos i where i.capacitacion_id=p_capacitacion_id and i.agente_id=per.profile_id) aprobado
    from public.personal per
    left join lateral (select * from public.capacitacion_progreso pr where pr.capacitacion_id=p_capacitacion_id and pr.agente_id=per.profile_id) pr on true
    where per.profile_id is not null and per.activo and private.capacitacion_asignada_a_personal(p_capacitacion_id,per.id)
  ) x;
  return v_result;
end $$;
revoke all on function public.reporte_capacitacion(uuid) from public,anon,authenticated;
grant execute on function public.reporte_capacitacion(uuid) to authenticated;

-- El listado del agente también debe mostrar la última nota en la escala vigesimal (antes
-- mostraba el conteo crudo de aciertos vía i.puntaje).
create or replace function public.listar_capacitaciones_agente() returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public,pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not private.es_agente() then raise exception 'No autorizado' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.completada, x.fecha_vencimiento nulls last, x.created_at desc),'[]'::jsonb) into v_result
  from (
    select c.id,c.titulo,c.descripcion,c.fecha_vencimiento,c.porcentaje_minimo_visto,c.nota_minima,c.created_at,
      coalesce(pr.porcentaje_visto,0) porcentaje_visto, coalesce(pr.video_completo,false) video_completo,
      (select max(i.puntaje) from public.examen_intentos i where i.capacitacion_id=c.id and i.agente_id=auth.uid() and i.aprobado) is not null completada,
      (select i.nota from public.examen_intentos i where i.capacitacion_id=c.id and i.agente_id=auth.uid() order by i.numero_intento desc limit 1) ultima_nota,
      (select count(*) from public.examen_intentos i where i.capacitacion_id=c.id and i.agente_id=auth.uid()) intentos
    from public.capacitaciones c
    left join public.capacitacion_progreso pr on pr.capacitacion_id=c.id and pr.agente_id=auth.uid()
    where c.estado='PUBLICADA' and private.capacitacion_asignada_a_mi(c.id)
  ) x;
  return v_result;
end $$;
revoke all on function public.listar_capacitaciones_agente() from public,anon,authenticated;
grant execute on function public.listar_capacitaciones_agente() to authenticated;

-- Permite al capacitador/admin ajustar la nota mínima (0-20) en cualquier momento mientras la
-- capacitación esté en borrador -- antes solo se fijaba al crearla.
create function public.actualizar_nota_minima(p_capacitacion_id uuid, p_nota_minima integer) returns public.capacitaciones
language plpgsql volatile security invoker set search_path=pg_catalog,public,pg_temp as $$
declare v_cap public.capacitaciones;
begin
  if p_nota_minima is null or p_nota_minima<0 or p_nota_minima>20 then
    raise exception 'La nota mínima debe estar entre 0 y 20' using errcode='22023'; end if;
  update public.capacitaciones set nota_minima=p_nota_minima, updated_at=now()
    where id=p_capacitacion_id and estado='BORRADOR' and (capacitador_id=auth.uid() or public.is_admin())
    returning * into v_cap;
  if not found then raise exception 'No se pudo actualizar (no encontrada, no autorizado, o ya no está en borrador)' using errcode='P0002'; end if;
  return v_cap;
end $$;
revoke all on function public.actualizar_nota_minima(uuid,integer) from public,anon,authenticated;
grant execute on function public.actualizar_nota_minima(uuid,integer) to authenticated;

notify pgrst,'reload schema';
commit;
