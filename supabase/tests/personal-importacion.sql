-- Importación de personal por DNI (con "set local role authenticated"): nuevas se crean, iguales se ignoran, distintas
-- se listan y solo se actualizan si se pide, y NUNCA se tocan profile_id, email ni cliente_actual_id; tampoco se
-- desactiva a quien no viene en el archivo. Incluye un archivo de más de 1000 filas (hasta 5000).
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.denied(command text,code text,label text) returns void language plpgsql as $$
begin
  begin execute command; exception when others then
    if sqlstate=code then raise notice 'PASS: % (rechazado %)',label,code; return; end if;
    raise exception 'FAIL % expected %, got %: %',label,code,sqlstate,sqlerrm;
  end;
  raise exception 'FAIL: % fue aceptado', label;
end $$;

insert into auth.users(id,email,raw_user_meta_data) values
 ('a1000000-0000-4000-8000-000000000001','admin-pers@example.test','{}'),
 ('a1000000-0000-4000-8000-000000000002','coord-pers@example.test','{}'),
 ('a1000000-0000-4000-8000-000000000003','agente-google@example.test','{}');
update public.profiles set role='admin' where id='a1000000-0000-4000-8000-000000000001';
update public.profiles set role='coordinador' where id='a1000000-0000-4000-8000-000000000002';
update public.profiles set role='agente' where id='a1000000-0000-4000-8000-000000000003';
insert into public.clientes(id,nombre,activo) values ('a2000000-0000-4000-8000-000000000001','RENIEC',true);
-- Personal ya cargado (RENIEC / INDECOPI): P1 normal, P2 con DNI guardado sin el cero inicial, P3 agente vinculado a Google,
-- D1/D2 con el mismo DNI (no hay restricción única), P5 persona que no viene en el archivo.
insert into public.personal(id,codigo_personal,nombre,dni,cargo,activo) values
 ('a3000000-0000-4000-8000-000000000001','R-1','ANA PEREZ','12345678','AGENTE',true),
 ('a3000000-0000-4000-8000-000000000002','R-2','LUIS TORRES','1234567','AGENTE',true),
 ('a3000000-0000-4000-8000-000000000003','I-1','MARIA RAMOS','22222222','AGENTE',true),
 ('a3000000-0000-4000-8000-000000000004','D-1','DUPLICADO UNO','33333333','AGENTE',true),
 ('a3000000-0000-4000-8000-000000000005','D-2','DUPLICADO DOS','33333333','AGENTE',true),
 ('a3000000-0000-4000-8000-000000000006','R-9','PERSONA FUERA DEL ARCHIVO','99999999','AGENTE',true);
update public.personal set profile_id='a1000000-0000-4000-8000-000000000003',email='agente-google@example.test',
  cliente_actual_id='a2000000-0000-4000-8000-000000000001' where id='a3000000-0000-4000-8000-000000000003';

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select set_config('qa.filas','[
 {"fila":2,"codigo_personal":"S-1","nombre":"PERSONA NUEVA","dni":"44444444","activo":true},
 {"fila":3,"codigo_personal":"R-1","nombre":"ana  perez","dni":"12345678","activo":true},
 {"fila":4,"codigo_personal":"R-2","nombre":"LUIS TORRES","dni":"01234567","activo":true},
 {"fila":5,"codigo_personal":"S-9","nombre":"MARIA RAMOS DE LA CRUZ","dni":"22222222","activo":true},
 {"fila":6,"codigo_personal":"S-6","nombre":"DNI REPETIDO EN LA BASE","dni":"33333333","activo":true},
 {"fila":7,"codigo_personal":"R-9","nombre":"CODIGO DE OTRO","dni":"55555555","activo":true}]',true);

\echo '--- vista previa ---'
select set_config('qa.prev',public.admin_importar_personal(current_setting('qa.filas')::jsonb,false)::text,true);
select pg_temp.ok((current_setting('qa.prev')::jsonb->>'nuevos')::int=1,'vista previa: 1 persona nueva (DNI 44444444)');
select pg_temp.ok((current_setting('qa.prev')::jsonb->>'sin_cambios')::int=1,'vista previa: 1 existente con los mismos datos (ANA PEREZ; el nombre solo difiere en mayúsculas/espacios)');
select pg_temp.ok(jsonb_array_length(current_setting('qa.prev')::jsonb->'diferencias')=2,'vista previa: 2 existentes con diferencias (filas 4 y 5)');
select pg_temp.ok(current_setting('qa.prev')::jsonb->'diferencias'->0->>'fila'='4' and current_setting('qa.prev')::jsonb->'diferencias'->0->'cambios'->0->>'campo'='dni'
  and current_setting('qa.prev')::jsonb->'diferencias'->0->'cambios'->0->>'actual'='1234567' and current_setting('qa.prev')::jsonb->'diferencias'->0->'cambios'->0->>'archivo'='01234567','DNI guardado sin cero (1234567) se empareja con 01234567 y se informa la diferencia');
select pg_temp.ok(current_setting('qa.prev')::jsonb->'diferencias'->1->>'fila'='5' and (current_setting('qa.prev')::jsonb->'diferencias'->1->>'vinculado')::boolean
  and (select count(*)=2 from jsonb_array_elements(current_setting('qa.prev')::jsonb->'diferencias'->1->'cambios') c where c->>'campo' in ('codigo_personal','nombre')),'el agente vinculado aparece con su valor actual y el del archivo (código y nombre)');
select pg_temp.ok(jsonb_array_length(current_setting('qa.prev')::jsonb->'errores')=2
  and (select bool_or(e->>'fila'='6' and e->>'mensaje' like '%repetido en la base%') from jsonb_array_elements(current_setting('qa.prev')::jsonb->'errores') e)
  and (select bool_or(e->>'fila'='7' and e->>'mensaje' like '%ya pertenece a otra persona (DNI 99999999)%') from jsonb_array_elements(current_setting('qa.prev')::jsonb->'errores') e),'errores con su fila: DNI repetido en la base (6) y código que pertenece a otro DNI (7)');
select pg_temp.ok((select count(*)=6 from public.personal),'la vista previa no escribe nada');

\echo '--- aplicar: por defecto "Mantener actual" ---'
select public.admin_importar_personal(current_setting('qa.filas')::jsonb,true);
select pg_temp.ok((select count(*)=7 from public.personal) and (select nombre='PERSONA NUEVA' and cargo='AGENTE' and activo from public.personal where dni='44444444'),'solo se creó la persona nueva (cargo por defecto AGENTE)');
select pg_temp.ok((select nombre='MARIA RAMOS' and codigo_personal='I-1' from public.personal where id='a3000000-0000-4000-8000-000000000003') and (select dni='1234567' from public.personal where id='a3000000-0000-4000-8000-000000000002'),'las existentes con diferencias NO cambian sin pedirlo');
reset role;
select pg_temp.ok((select count(*)=7 from public.personal where activo),'nadie se desactivó (P5 no venía en el archivo)');

\echo '--- aplicar con Actualizar: el agente vinculado conserva su vinculación ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select public.admin_importar_personal(current_setting('qa.filas')::jsonb,true,'["22222222"]'::jsonb);
select pg_temp.ok((select nombre='MARIA RAMOS DE LA CRUZ' and codigo_personal='S-9' from public.personal where id='a3000000-0000-4000-8000-000000000003'),'Actualizar: nombre y código del agente se actualizan');
reset role;
select pg_temp.ok((select profile_id='a1000000-0000-4000-8000-000000000003' and email='agente-google@example.test' and cliente_actual_id='a2000000-0000-4000-8000-000000000001' from public.personal where id='a3000000-0000-4000-8000-000000000003'),'profile_id, email y cliente_actual_id del agente vinculado NO cambian');
select pg_temp.ok((select dni='1234567' from public.personal where id='a3000000-0000-4000-8000-000000000002'),'solo se actualizó el DNI elegido: el otro existente con diferencias sigue igual');
select pg_temp.ok((select (valores_antes->0->>'nombre')='MARIA RAMOS' and (valores_antes->0->>'codigo_personal')='I-1' and (valores_despues->>'actualizados')::int=1 from private.admin_catalog_audit where accion='IMPORTAR' and catalogo='personal' and valores_despues->>'actualizados'='1'),'la auditoría guarda el estado anterior de lo actualizado');
select pg_temp.ok((select count(*)=2 from private.admin_catalog_audit where accion='IMPORTAR' and catalogo='personal'),'cada aplicación queda registrada (las vistas previas no)');

\echo '--- archivo grande (más de 1000 filas) ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select set_config('qa.grande',(select jsonb_agg(jsonb_build_object('fila',g+1,'codigo_personal','SEG-'||g,'nombre','PERSONA SEGUROC '||g,'dni',lpad((60000000+g)::text,8,'0'),'cargo','AGENTE','activo',true)) from generate_series(1,2500) g)::text,true);
select pg_temp.ok((public.admin_importar_personal(current_setting('qa.grande')::jsonb,false)->>'nuevos')::int=2500,'vista previa de 2500 personas: 2500 nuevas');
select public.admin_importar_personal(current_setting('qa.grande')::jsonb,true);
select pg_temp.ok((select count(*)=2500 from public.personal where codigo_personal like 'SEG-%'),'se importaron 2500 personas en una sola transacción');
select pg_temp.ok((public.admin_importar_personal(current_setting('qa.grande')::jsonb,false)->>'sin_cambios')::int=2500,'reimportar el mismo archivo: 2500 sin cambios, ninguna nueva');
select pg_temp.denied(format($q$select public.admin_importar_personal('%s'::jsonb,false)$q$,(select jsonb_agg(jsonb_build_object('fila',g+1,'codigo_personal','X-'||g,'nombre','N','dni',lpad(g::text,8,'0'),'activo',true)) from generate_series(1,5001) g)),'22023','más de 5000 filas se rechaza');

\echo '--- validaciones y permisos ---'
select pg_temp.denied('select public.admin_importar_personal(''[{"fila":2,"codigo_personal":"A","nombre":"N","dni":"1234567","activo":true}]'',false)','22023','DNI de 7 dígitos (sin completar) se rechaza: la pantalla lo completa antes');
select pg_temp.denied('select public.admin_importar_personal(''[{"fila":2,"codigo_personal":"A","nombre":"N","dni":"12A45678","activo":true}]'',false)','22023','DNI con letras se rechaza');
select pg_temp.denied('select public.admin_importar_personal(''[{"fila":2,"codigo_personal":"A","nombre":"N","dni":"70000001","activo":true},{"fila":3,"codigo_personal":"B","nombre":"M","dni":"70000001","activo":true}]'',false)','22023','DNI repetido dentro del archivo (guardia del servidor)');
select pg_temp.denied('select public.admin_importar_personal(''[{"fila":2,"codigo_personal":"A","nombre":"N","dni":"70000001","activo":true},{"fila":3,"codigo_personal":"A","nombre":"M","dni":"70000002","activo":true}]'',false)','22023','código repetido dentro del archivo (guardia del servidor)');
select pg_temp.denied('select public.admin_importar_personal(''[]'',false)','22023','archivo vacío');
select pg_temp.denied('select public.admin_importar_catalogo(''personal'',''[]'')','42883','la importación antigua (upsert silencioso) ya no existe');
select public.admin_importar_personal('[{"fila":2,"codigo_personal":"G-1","nombre":"GUARDIA","dni":"70000009","activo":true}]',true,'[]','GUARDIA DE SEGURIDAD');
select pg_temp.ok((select cargo='GUARDIA DE SEGURIDAD' from public.personal where dni='70000009'),'las personas nuevas sin cargo usan el cargo por defecto elegido');
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
select pg_temp.denied('select public.admin_importar_personal(''[{"fila":2,"codigo_personal":"N-1","nombre":"X","dni":"70000010","activo":true}]'',true)','42501','un coordinador no puede importar personal');
reset role;
select pg_temp.denied($q$set local role anon; select public.admin_importar_personal('[]',false)$q$,'42501','anon no puede ejecutar la RPC');

rollback;
