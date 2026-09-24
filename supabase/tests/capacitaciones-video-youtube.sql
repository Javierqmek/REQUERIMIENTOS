-- Valida el enlace de YouTube como fuente de video: el check de formato, que nunca puedan
-- coexistir archivo y enlace, y que publicar_capacitacion acepte un video de YouTube igual que
-- uno subido a Storage. Corre con "set local role authenticated" (nunca como superusuario) para
-- las operaciones de la API, como el resto de pruebas nuevas de este directorio.
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
 ('ce000000-0000-4000-8000-000000000001','capacitador-yt@example.test','{}');
update public.profiles set role='capacitador' where id='ce000000-0000-4000-8000-000000000001';

select pg_temp.denied(
  $$insert into public.capacitaciones(titulo,capacitador_id,video_youtube_id) values
    ('Formato inválido','ce000000-0000-4000-8000-000000000001','invalid id!')$$,
  '23514');

insert into public.capacitaciones(id,titulo,capacitador_id,video_path,video_nombre) values
 ('cf000000-0000-4000-8000-000000000001','Con archivo','ce000000-0000-4000-8000-000000000001',
   'cf000000-0000-4000-8000-000000000001/video.mp4','video.mp4');
select pg_temp.denied(
  $$update public.capacitaciones set video_youtube_id='dQw4w9WgXcQ' where id='cf000000-0000-4000-8000-000000000001'$$,
  '23514');

insert into public.capacitaciones(id,titulo,capacitador_id,video_youtube_id,nota_minima) values
 ('cf000000-0000-4000-8000-000000000002','Con YouTube','ce000000-0000-4000-8000-000000000001','dQw4w9WgXcQ',1);
insert into public.examen_preguntas(id,capacitacion_id,enunciado) values
 ('cf000000-0000-4000-8000-000000000003','cf000000-0000-4000-8000-000000000002','¿Pregunta?');
insert into public.examen_opciones(pregunta_id,texto,es_correcta,orden) values
 ('cf000000-0000-4000-8000-000000000003','Sí',true,0),
 ('cf000000-0000-4000-8000-000000000003','No',false,1);

set local role authenticated;
select set_config('request.jwt.claim.sub','ce000000-0000-4000-8000-000000000001',true);

select pg_temp.ok((select estado from public.publicar_capacitacion('cf000000-0000-4000-8000-000000000002'))='PUBLICADA',
  'publicar_capacitacion acepta un video de YouTube (sin archivo en Storage)');

insert into public.capacitaciones(id,titulo,capacitador_id) values
 ('cf000000-0000-4000-8000-000000000004','Sin video','ce000000-0000-4000-8000-000000000001');
insert into public.examen_preguntas(id,capacitacion_id,enunciado) values
 ('cf000000-0000-4000-8000-000000000005','cf000000-0000-4000-8000-000000000004','¿Pregunta?');
insert into public.examen_opciones(pregunta_id,texto,es_correcta,orden) values
 ('cf000000-0000-4000-8000-000000000005','Sí',true,0);
select pg_temp.denied($$select public.publicar_capacitacion('cf000000-0000-4000-8000-000000000004')$$,'22023');

reset role;
rollback;
