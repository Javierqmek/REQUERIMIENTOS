-- Valida la calificación en escala vigesimal (0-20): la nota se calcula server-side como
-- (aciertos/total)*20 con 1 decimal, la nota mínima es editable en borrador (0-20, ya no exige
-- "no superar el número de preguntas"), y el reporte/listado del agente muestran la nota nueva.
-- Corre con "set local role authenticated" (nunca superusuario) para las operaciones de la API.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.denied(command text,code text) returns void language plpgsql as $$
begin
  begin execute command; exception when others then
    if sqlstate=code then raise notice 'PASS: rejected %',code; return; end if;
    raise exception 'FAIL expected %, got %: %',code,sqlstate,sqlerrm;
  end;
  raise exception 'FAIL: accepted forbidden operation';
end $$;

insert into auth.users(id,email,raw_user_meta_data) values
 ('da100000-0000-4000-8000-000000000001','capacitador-nota@example.test','{}'),
 ('da100000-0000-4000-8000-000000000002','agente-nota@example.test','{}');
update public.profiles set role='capacitador' where id='da100000-0000-4000-8000-000000000001';
update public.profiles set role='agente' where id='da100000-0000-4000-8000-000000000002';
insert into public.personal(id,codigo_personal,nombre,dni,cargo,cliente,unidad,activo,profile_id) values
 ('da200000-0000-4000-8000-000000000001','NOTA-1','Agente Nota','66666666','Agente','','','t','da100000-0000-4000-8000-000000000002');

-- 10 preguntas, nota_minima por defecto (14), sin superar el chequeo viejo (ya no existe).
insert into public.capacitaciones(id,titulo,capacitador_id,video_youtube_id) values
 ('da300000-0000-4000-8000-000000000001','Examen de 10 preguntas','da100000-0000-4000-8000-000000000001','dQw4w9WgXcQ');
select pg_temp.ok((select nota_minima from public.capacitaciones where id='da300000-0000-4000-8000-000000000001')=14,
  'nueva capacitación usa el valor por defecto 14 (escala 0-20)');
select pg_temp.denied($$insert into public.capacitaciones(titulo,capacitador_id,nota_minima) values
  ('Fuera de rango','da100000-0000-4000-8000-000000000001',21)$$,'23514');

do $$
declare i integer; v_pregunta_id uuid;
begin
  for i in 1..10 loop
    insert into public.examen_preguntas(capacitacion_id,enunciado) values
      ('da300000-0000-4000-8000-000000000001','Pregunta '||i) returning id into v_pregunta_id;
    insert into public.examen_opciones(pregunta_id,texto,es_correcta,orden) values
      (v_pregunta_id,'Correcta',true,0),(v_pregunta_id,'Incorrecta',false,1);
  end loop;
end $$;
-- Antes existía "nota_minima no puede superar el número de preguntas"; con 10 preguntas y
-- nota_minima=14 (escala 0-20) publicar debía funcionar igual (la validación ya no aplica).
insert into public.capacitacion_asignaciones(capacitacion_id,cliente_id) values
 ('da300000-0000-4000-8000-000000000001',null);

set local role authenticated;
select set_config('request.jwt.claim.sub','da100000-0000-4000-8000-000000000001',true);

select pg_temp.ok((select estado from public.publicar_capacitacion('da300000-0000-4000-8000-000000000001'))='PUBLICADA',
  'publicar_capacitacion ya no exige nota_minima <= número de preguntas');

-- Nota mínima editable en borrador -- pero esta ya está PUBLICADA, así que debe rechazarse.
select pg_temp.denied($$select public.actualizar_nota_minima('da300000-0000-4000-8000-000000000001',10)$$,'P0002');

reset role;
-- Segunda capacitación, en borrador, para probar la edición de nota mínima antes de publicar.
insert into public.capacitaciones(id,titulo,capacitador_id,video_youtube_id,nota_minima) values
 ('da300000-0000-4000-8000-000000000002','Otra capacitación','da100000-0000-4000-8000-000000000001','dQw4w9WgXcQ',14);
set local role authenticated;
select set_config('request.jwt.claim.sub','da100000-0000-4000-8000-000000000001',true);
select pg_temp.ok((select nota_minima from public.actualizar_nota_minima('da300000-0000-4000-8000-000000000002',12))=12,
  'la nota mínima se puede editar mientras la capacitación esté en borrador');
select pg_temp.denied($$select public.actualizar_nota_minima('da300000-0000-4000-8000-000000000002',25)$$,'22023');
reset role;

-- Arma las respuestas (7 correctas, 3 incorrectas) leyendo examen_opciones como el capacitador
-- dueño (RLS le permite ver es_correcta) -- el agente NUNCA puede leer esa columna directamente,
-- por diseño (solo la ve indirectamente vía iniciar_examen, que la oculta).
set local role authenticated;
select set_config('request.jwt.claim.sub','da100000-0000-4000-8000-000000000001',true);
do $$
declare v_respuestas jsonb := '[]'::jsonb; v_pregunta record; v_i integer := 0;
begin
  for v_pregunta in select q.id, (select o.id from public.examen_opciones o where o.pregunta_id=q.id and o.es_correcta) correcta,
      (select o.id from public.examen_opciones o where o.pregunta_id=q.id and not o.es_correcta) incorrecta
    from public.examen_preguntas q where q.capacitacion_id='da300000-0000-4000-8000-000000000001' order by q.id
  loop
    v_i := v_i+1;
    v_respuestas := v_respuestas || jsonb_build_object('pregunta_id',v_pregunta.id,
      'opcion_id', case when v_i<=7 then v_pregunta.correcta else v_pregunta.incorrecta end);
  end loop;
  perform set_config('pg_temp.respuestas', v_respuestas::text, false);
end $$;
reset role;

-- Progreso de video + examen del agente: 7/10 correctas debe dar nota 14.0, exactamente la
-- mínima -> aprobado (>=, no solo >).
set local role authenticated;
select set_config('request.jwt.claim.sub','da100000-0000-4000-8000-000000000002',true);
select public.registrar_progreso_video('da300000-0000-4000-8000-000000000001',100);
select pg_temp.ok((select jsonb_array_length(public.iniciar_examen('da300000-0000-4000-8000-000000000001')->'preguntas'))=10,
  'el agente puede iniciar el examen con las 10 preguntas');

select pg_temp.ok((public.enviar_examen('da300000-0000-4000-8000-000000000001',current_setting('pg_temp.respuestas')::jsonb)->>'nota')::numeric = 14.0,
  '7/10 correctas = nota 14.0 (aciertos/total*20, 1 decimal)');
select pg_temp.ok((public.enviar_examen('da300000-0000-4000-8000-000000000001',current_setting('pg_temp.respuestas')::jsonb)->>'aprobado')::boolean,
  'nota igual a la mínima (14.0 >= 14) también aprueba, no solo estrictamente mayor');

select pg_temp.ok((select (i.ultima_nota)::numeric=14.0 from jsonb_to_recordset(public.listar_capacitaciones_agente()) as i(id uuid,ultima_nota numeric)
    where i.id='da300000-0000-4000-8000-000000000001'),
  'el listado del agente muestra la última nota en escala vigesimal');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','da100000-0000-4000-8000-000000000001',true);
select pg_temp.ok((select (mejor_nota)::numeric=14.0 from jsonb_to_recordset(public.reporte_capacitacion('da300000-0000-4000-8000-000000000001')) as r(mejor_nota numeric)
    limit 1),
  'el reporte del capacitador muestra la mejor nota en escala vigesimal');
reset role;

rollback;
