-- Alternativa a subir el video a Storage: guardar solo el ID de un video de YouTube (se
-- recomienda "no listado") y reproducirlo con la IFrame Player API en el navegador del agente.
-- El plan gratuito de Supabase limita cada archivo a 50 MB además de un tope mensual de
-- almacenamiento y transferencia -- YouTube no consume nada de eso.
begin;

alter table public.capacitaciones add column video_youtube_id text;
alter table public.capacitaciones add constraint capacitaciones_video_youtube_id_formato
  check (video_youtube_id is null or video_youtube_id ~ '^[A-Za-z0-9_-]{11}$');
-- Una sola fuente de video a la vez: nunca archivo Y enlace simultáneamente (ambas rutas de
-- guardado, /subir/confirmar y /video-youtube, limpian la otra columna al escribir la suya).
alter table public.capacitaciones add constraint capacitaciones_video_una_sola_fuente
  check (video_path is null or video_youtube_id is null);

-- Publicar ahora exige video de Storage O enlace de YouTube (antes solo aceptaba video_path).
-- Firma y demás validaciones sin cambios.
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
  if v_cap.nota_minima > v_preguntas then raise exception 'La nota mínima no puede superar el número de preguntas' using errcode='22023'; end if;
  update public.capacitaciones set estado='PUBLICADA', updated_at=now() where id=p_capacitacion_id returning * into v_cap;
  return v_cap;
end $$;
revoke all on function public.publicar_capacitacion(uuid) from public,anon,authenticated;
grant execute on function public.publicar_capacitacion(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
