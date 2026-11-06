-- Editar renovación y cargo de requerimientos ya creados + catálogo de cargos, con "set local role authenticated".
--  A. Catálogo de cargos (Mantenimiento) y validación en Personal y en la importación.
--  B. Copia del cargo en el requerimiento al crear; el cargo elegido actualiza la ficha.
--  C. editar_cabecera_requerimiento: renovación con confirmación de líneas, referencia interna, cargo, auditoría.
--  D. Permisos: coordinador dueño / ajeno, admin, superadmin, requerimiento Atendido, cargo inactivo.
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
create function pg_temp.como(p uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub',p::text,true) $$;

insert into auth.users(id,email,raw_user_meta_data) values
 ('d1000000-0000-4000-8000-000000000001','admin-car@example.test','{}'),
 ('d1000000-0000-4000-8000-000000000002','coord-car@example.test','{}'),
 ('d1000000-0000-4000-8000-000000000003','ajeno-car@example.test','{}'),
 ('d1000000-0000-4000-8000-000000000004','super-car@example.test','{}');
update public.profiles set role='admin' where id='d1000000-0000-4000-8000-000000000001';
update public.profiles set role='coordinador' where id in ('d1000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000003');
update public.profiles set role='superadmin' where id='d1000000-0000-4000-8000-000000000004';
insert into public.cargos(nombre,origen) values ('AGENTE','existente'),('CARGO RETIRADO','manual');
update public.cargos set activo=false where nombre='CARGO RETIRADO';
insert into public.clientes(id,nombre,activo) values ('d2000000-0000-4000-8000-000000000001','RENIEC',true);
insert into public.unidades(id,cliente_id,nombre,activo) values ('d3000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','RENIEC SEDE',true);
insert into public.personal(id,codigo_personal,nombre,dni,cargo,activo) values
 ('d4000000-0000-4000-8000-000000000001','CAR-1','AGENTE UNO','55555551','AGENTE',true),
 ('d4000000-0000-4000-8000-000000000002','CAR-2','AGENTE DOS','55555552','AGENTE',true);

\echo '--- A. catálogo de cargos ---'
select pg_temp.ok((select count(*)=4 from public.cargos where origen='inicial' and nombre in ('AGENTE DIA','AGENTE NOCHE','DESCANSERO','SUPERVISOR')),'la carga inicial trae AGENTE DIA, AGENTE NOCHE, DESCANSERO y SUPERVISOR');
set local role authenticated;
select pg_temp.como('d1000000-0000-4000-8000-000000000001');
select public.admin_guardar_catalogo('cargos',null,'{"nombre":"Supervisor de zona"}');
select pg_temp.denied($q$select public.admin_guardar_catalogo('cargos',null,'{"nombre":"SUPERVISOR DE ZONA"}')$q$,'23505','cargo repetido (sin distinguir mayúsculas)');
select pg_temp.ok((public.admin_listar_catalogo('cargos','zona')->>'total')::int=1,'Mantenimiento lista y busca cargos');
select pg_temp.denied($q$select public.admin_guardar_catalogo('personal',null,'{"codigo_personal":"CAR-9","nombre":"NUEVO","dni":"55555559","cargo":"INVENTADO"}')$q$,'22023','Personal: un cargo que no existe se rechaza');
select pg_temp.denied($q$select public.admin_guardar_catalogo('personal',null,'{"codigo_personal":"CAR-9","nombre":"NUEVO","dni":"55555559","cargo":"CARGO RETIRADO"}')$q$,'22023','Personal: un cargo inactivo se rechaza');
select public.admin_guardar_catalogo('personal',null,'{"codigo_personal":"CAR-9","nombre":"NUEVO","dni":"55555559","cargo":"descansero"}');
select pg_temp.ok((select cargo='DESCANSERO' from public.personal where codigo_personal='CAR-9'),'Personal: el cargo se guarda con el nombre del catálogo');
select public.admin_actualizar_catalogo_activo('cargos',(select id from public.cargos where nombre='AGENTE DIA'),false);
select public.admin_actualizar_catalogo_activo('cargos',(select id from public.cargos where nombre='AGENTE DIA'),true);
reset role;
select pg_temp.ok((select count(*)>=2 from private.admin_catalog_audit where catalogo='cargos'),'crear y desactivar cargos queda en la auditoría');
set local role authenticated;
select pg_temp.como('d1000000-0000-4000-8000-000000000002');
select pg_temp.denied($q$select public.admin_guardar_catalogo('cargos',null,'{"nombre":"OTRO"}')$q$,'42501','un coordinador no administra cargos');
select pg_temp.ok((select count(*)>0 from public.cargos where activo) and not exists(select 1 from public.cargos where nombre='CARGO RETIRADO'),'el coordinador ve solo los cargos activos');
reset role;
select pg_temp.denied($q$set constraints personal_cargo_fkey immediate; update public.personal set cargo='NO EXISTE' where codigo_personal='CAR-1'$q$,'23503','personal.cargo referencia al catálogo (se verifica al confirmar)');

\echo '--- A. importación de personal con el catálogo ---'
set local role authenticated;
select pg_temp.como('d1000000-0000-4000-8000-000000000001');
select set_config('qa.imp',public.admin_importar_personal('[
 {"fila":2,"codigo_personal":"I-1","nombre":"CON CARGO","dni":"66666661","cargo":"supervisor","activo":true},
 {"fila":3,"codigo_personal":"I-2","nombre":"CARGO FALSO","dni":"66666662","cargo":"PIRATA","activo":true},
 {"fila":4,"codigo_personal":"I-3","nombre":"CARGO INACTIVO","dni":"66666663","cargo":"CARGO RETIRADO","activo":true},
 {"fila":5,"codigo_personal":"I-4","nombre":"SIN CARGO","dni":"66666664","activo":true}]',false,'[]','AGENTE')::text,true);
select pg_temp.ok((current_setting('qa.imp')::jsonb->>'nuevos')::int=2
  and (select bool_and(e->>'fila' in ('3','4')) and count(*)=2 from jsonb_array_elements(current_setting('qa.imp')::jsonb->'errores') e)
  and (select bool_or(e->>'mensaje' like '%"PIRATA"%no existe%') from jsonb_array_elements(current_setting('qa.imp')::jsonb->'errores') e),'importar: cargo inexistente o inactivo es error con su número de fila; el resto se importa');
select public.admin_importar_personal('[{"fila":2,"codigo_personal":"I-1","nombre":"CON CARGO","dni":"66666661","cargo":"supervisor","activo":true},{"fila":5,"codigo_personal":"I-4","nombre":"SIN CARGO","dni":"66666664","activo":true}]',true,'[]','AGENTE');
select pg_temp.ok((select cargo='SUPERVISOR' from public.personal where dni='66666661') and (select cargo='AGENTE' from public.personal where dni='66666664'),'importar: el cargo se guarda con el nombre del catálogo y las personas sin cargo usan el cargo por defecto');
select pg_temp.ok(jsonb_array_length(public.admin_importar_personal('[{"fila":2,"codigo_personal":"I-5","nombre":"NUEVO","dni":"66666665","activo":true}]',false,'[]','NO EXISTE')->'errores')=1,'importar: un cargo por defecto inexistente marca error en las personas nuevas');
reset role;

\echo '--- B. copia del cargo al crear ---'
-- Prendas del cliente (por importación): AMBOS, solo VERANO y solo INVIERNO
set local role authenticated;
select pg_temp.como('d1000000-0000-4000-8000-000000000001');
select public.admin_importar_prendas('d2000000-0000-4000-8000-000000000001',
 '[{"fila":2,"codigo_prenda":"P-AMB","nombre_prenda":"CAMISA AMBOS","codigo_almacen":"A1","precio":10,"cantidad":2,"genero":"AMBOS","renovacion":"AMBOS","activo":true},
   {"fila":3,"codigo_prenda":"P-VER","nombre_prenda":"POLO VERANO","codigo_almacen":"A2","precio":20,"cantidad":1,"genero":"AMBOS","renovacion":"VERANO","activo":true},
   {"fila":4,"codigo_prenda":"P-INV","nombre_prenda":"ABRIGO INVIERNO","codigo_almacen":"A3","precio":30,"cantidad":3,"genero":"AMBOS","renovacion":"INVIERNO","activo":true}]',true);
select set_config('qa.amb',(select id::text from public.prendas where codigo_prenda='P-AMB'),true);
select set_config('qa.ver',(select id::text from public.prendas where codigo_prenda='P-VER'),true);
select set_config('qa.inv',(select id::text from public.prendas where codigo_prenda='P-INV'),true);
select pg_temp.como('d1000000-0000-4000-8000-000000000002');
select set_config('qa.r1',public.crear_requerimiento('d4000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','VERANO',
  format('[{"prenda_id":"%s"},{"prenda_id":"%s"}]',current_setting('qa.amb'),current_setting('qa.ver'))::jsonb,gen_random_uuid(),'HOMBRE')::text,true);
select pg_temp.ok((select cargo='AGENTE' from public.requerimientos where id=current_setting('qa.r1')::uuid),'al crear, el requerimiento guarda una copia del cargo actual del agente');
select set_config('qa.r2',public.crear_requerimiento('d4000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','VERANO',
  format('[{"prenda_id":"%s"}]',current_setting('qa.amb'))::jsonb,gen_random_uuid(),'HOMBRE',null,'supervisor')::text,true);
select pg_temp.ok((select cargo='SUPERVISOR' from public.requerimientos where id=current_setting('qa.r2')::uuid)
  and (select cargo='SUPERVISOR' from public.personal where codigo_personal='CAR-2'),'al crear con otro cargo (lista desplegable) se guarda en el requerimiento y en la ficha');
reset role;
select pg_temp.ok(exists(select 1 from private.admin_catalog_audit where catalogo='personal' and valores_despues->>'origen'='crear_requerimiento'),'el cambio de la ficha al crear queda en la auditoría');
set local role authenticated;
select pg_temp.como('d1000000-0000-4000-8000-000000000002');
select pg_temp.denied(format($q$select public.crear_requerimiento('d4000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','VERANO','[{"prenda_id":"%s"}]'::jsonb,gen_random_uuid(),'HOMBRE',null,'CARGO RETIRADO')$q$,current_setting('qa.amb')),'22023','crear con un cargo inactivo se rechaza');
select pg_temp.denied(format($q$select public.crear_requerimiento('d4000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','VERANO','[{"prenda_id":"%s"}]'::jsonb,gen_random_uuid(),'HOMBRE',null,'INVENTADO')$q$,current_setting('qa.amb')),'22023','crear con un cargo inexistente se rechaza');
reset role;
update public.personal set cargo='AGENTE' where codigo_personal='CAR-2';   -- para las pruebas siguientes

\echo '--- C. editar renovación: confirmación de líneas ---'
set local role authenticated;
select pg_temp.como('d1000000-0000-4000-8000-000000000002');
select set_config('qa.res',public.editar_cabecera_requerimiento(current_setting('qa.r1')::uuid,'INVIERNO')::text,true);
select pg_temp.ok((current_setting('qa.res')::jsonb->>'requiere_confirmacion')::boolean and jsonb_array_length(current_setting('qa.res')::jsonb->'lineas')=1
  and current_setting('qa.res')::jsonb#>>'{lineas,0,codigo}'='P-VER','sin confirmar: devuelve la lista de prendas que no corresponden (solo el polo de verano)');
reset role;
select pg_temp.ok((select renovacion='VERANO' and referencia_interna='RENOVACION VERANO' from public.requerimientos where id=current_setting('qa.r1')::uuid)
  and (select count(*)=2 from public.detalle_requerimiento where requerimiento_id=current_setting('qa.r1')::uuid and activo)
  and not exists(select 1 from public.requerimiento_cambios),'sin confirmar no cambia nada ni deja historial');
set local role authenticated;
select pg_temp.como('d1000000-0000-4000-8000-000000000002');
select set_config('qa.res',public.editar_cabecera_requerimiento(current_setting('qa.r1')::uuid,'INVIERNO',null,array[gen_random_uuid()])::text,true);
select pg_temp.ok((current_setting('qa.res')::jsonb->>'requiere_confirmacion')::boolean,'una confirmación que no coincide con la lista actual vuelve a pedirse');
select set_config('qa.lineas',(select array_agg(x->>'id')::text from jsonb_array_elements(public.editar_cabecera_requerimiento(current_setting('qa.r1')::uuid,'INVIERNO')->'lineas') x),true);
select set_config('qa.res',public.editar_cabecera_requerimiento(current_setting('qa.r1')::uuid,'INVIERNO',null,current_setting('qa.lineas')::uuid[])::text,true);
select pg_temp.ok((current_setting('qa.res')::jsonb->>'ok')::boolean and current_setting('qa.res')::jsonb#>>'{data,requerimiento,renovacion}'='INVIERNO'
  and current_setting('qa.res')::jsonb#>>'{data,requerimiento,referencia_interna}'='RENOVACION INVIERNO','confirmado: cambia la renovación y la referencia interna de SIDIGE (RENOVACION INVIERNO)');
reset role;
select pg_temp.ok((select not d.activo and d.retirado_por='d1000000-0000-4000-8000-000000000002' and d.retirado_at is not null and d.cantidad=1 from public.detalle_requerimiento d where d.requerimiento_id=current_setting('qa.r1')::uuid and d.prenda_id=current_setting('qa.ver')::uuid)
  and (select d.activo and d.cantidad=2 from public.detalle_requerimiento d where d.requerimiento_id=current_setting('qa.r1')::uuid and d.prenda_id=current_setting('qa.amb')::uuid)
  and (select count(*)=2 from public.detalle_requerimiento where requerimiento_id=current_setting('qa.r1')::uuid),'la línea que no corresponde se desactiva (no se borra) y la AMBOS se conserva intacta');
select pg_temp.ok((select renovacion_antes='VERANO' and renovacion_despues='INVIERNO' and referencia_antes='RENOVACION VERANO' and referencia_despues='RENOVACION INVIERNO'
    and cargo_antes is null and cargo_despues is null and usuario_id='d1000000-0000-4000-8000-000000000002' and jsonb_array_length(lineas_quitadas)=1 and lineas_quitadas->0->>'codigo'='P-VER'
  from public.requerimiento_cambios where requerimiento_id=current_setting('qa.r1')::uuid),'el historial guarda valor anterior, nuevo, usuario y líneas quitadas');
-- volver a Verano: la línea AMBOS corresponde, el polo ya retirado no se reactiva, no hace falta confirmar
set local role authenticated;
select pg_temp.como('d1000000-0000-4000-8000-000000000002');
select set_config('qa.res',public.editar_cabecera_requerimiento(current_setting('qa.r1')::uuid,'VERANO')::text,true);
select pg_temp.ok((current_setting('qa.res')::jsonb->>'ok')::boolean and current_setting('qa.res')::jsonb#>>'{data,requerimiento,renovacion}'='VERANO'
  and (select count(*)=1 from public.detalle_requerimiento where requerimiento_id=current_setting('qa.r1')::uuid and activo),'volver a Verano sin prendas fuera de lugar no pide confirmación y no reactiva líneas retiradas');
select pg_temp.ok((public.editar_cabecera_requerimiento(current_setting('qa.r1')::uuid,'VERANO')->>'sin_cambios')::boolean,'la misma renovación y sin cargo no cambia nada');
reset role;

\echo '--- C. editar cargo ---'
set local role authenticated;
select pg_temp.como('d1000000-0000-4000-8000-000000000002');
select public.editar_cabecera_requerimiento(current_setting('qa.r1')::uuid,null,'descansero');
reset role;
select pg_temp.ok((select cargo='DESCANSERO' from public.requerimientos where id=current_setting('qa.r1')::uuid)
  and (select cargo='DESCANSERO' from public.personal where codigo_personal='CAR-1')
  and (select cargo='SUPERVISOR' from public.requerimientos where id=current_setting('qa.r2')::uuid),'el cargo se actualiza en el requerimiento y en la ficha; el otro requerimiento conserva su copia');
select pg_temp.ok((select cargo_antes='AGENTE' and cargo_despues='DESCANSERO' and cargo_ficha_antes='AGENTE' and renovacion_antes is null and lineas_quitadas='[]'::jsonb from public.requerimiento_cambios
  where requerimiento_id=current_setting('qa.r1')::uuid order by created_at desc,id desc limit 1) is not null
  and exists(select 1 from public.requerimiento_cambios where requerimiento_id=current_setting('qa.r1')::uuid and cargo_antes='AGENTE' and cargo_despues='DESCANSERO' and cargo_ficha_antes='AGENTE'),'el historial guarda el cargo anterior y el nuevo');
select pg_temp.ok(exists(select 1 from private.admin_catalog_audit where catalogo='personal' and valores_despues->>'origen'='editar_requerimiento' and valores_despues->>'cargo'='DESCANSERO'),'el cambio de la ficha queda en la auditoría');
set local role authenticated;
select pg_temp.como('d1000000-0000-4000-8000-000000000002');
select pg_temp.denied(format($q$select public.editar_cabecera_requerimiento(%L,null,'CARGO RETIRADO')$q$,current_setting('qa.r1')),'22023','cargo inactivo: se rechaza');
select pg_temp.denied(format($q$select public.editar_cabecera_requerimiento(%L,null,'INVENTADO')$q$,current_setting('qa.r1')),'22023','cargo inexistente: se rechaza');
select pg_temp.denied(format($q$select public.editar_cabecera_requerimiento(%L)$q$,current_setting('qa.r1')),'22023','sin ningún cambio se rechaza');
select pg_temp.denied(format($q$select public.editar_cabecera_requerimiento(%L,'PRIMAVERA')$q$,current_setting('qa.r1')),'22023','renovación inválida se rechaza');
-- renovación y cargo juntos
select public.editar_cabecera_requerimiento(current_setting('qa.r2')::uuid,'INVIERNO','AGENTE NOCHE',null);
reset role;
select pg_temp.ok((select renovacion='INVIERNO' and cargo='AGENTE NOCHE' and referencia_interna='RENOVACION INVIERNO' from public.requerimientos where id=current_setting('qa.r2')::uuid),'renovación y cargo juntos en una sola operación (AMBOS se conserva sin confirmar)');

\echo '--- D. permisos y estados ---'
set local role authenticated;
select pg_temp.como('d1000000-0000-4000-8000-000000000003');
select pg_temp.denied(format($q$select public.editar_cabecera_requerimiento(%L,'INVIERNO')$q$,current_setting('qa.r1')),'42501','coordinador ajeno: no autorizado');
select pg_temp.denied(format($q$select public.editar_cabecera_requerimiento(%L,null,'SUPERVISOR')$q$,current_setting('qa.r1')),'42501','coordinador ajeno: tampoco el cargo');
select pg_temp.como('d1000000-0000-4000-8000-000000000001');
select public.editar_cabecera_requerimiento(current_setting('qa.r1')::uuid,null,'SUPERVISOR');
select pg_temp.como('d1000000-0000-4000-8000-000000000004');
select public.editar_cabecera_requerimiento(current_setting('qa.r1')::uuid,null,'AGENTE');
reset role;
select pg_temp.ok((select cargo='AGENTE' from public.requerimientos where id=current_setting('qa.r1')::uuid) and (select count(distinct usuario_id)=3 from public.requerimiento_cambios where requerimiento_id=current_setting('qa.r1')::uuid),'admin y superadmin pueden editar; cada cambio queda con su usuario');
update public.requerimientos set estado='Observado' where id=current_setting('qa.r1')::uuid;
set local role authenticated;
select pg_temp.como('d1000000-0000-4000-8000-000000000002');
select public.editar_cabecera_requerimiento(current_setting('qa.r1')::uuid,null,'SUPERVISOR');
reset role;
select pg_temp.ok((select cargo='SUPERVISOR' from public.requerimientos where id=current_setting('qa.r1')::uuid),'en estado Observado también se puede editar');
update public.requerimientos set estado='Atendido' where id=current_setting('qa.r1')::uuid;
set local role authenticated;
select pg_temp.como('d1000000-0000-4000-8000-000000000002');
select pg_temp.denied(format($q$select public.editar_cabecera_requerimiento(%L,'INVIERNO')$q$,current_setting('qa.r1')),'55000','requerimiento Atendido: no se puede cambiar la renovación');
select pg_temp.denied(format($q$select public.editar_cabecera_requerimiento(%L,null,'AGENTE')$q$,current_setting('qa.r1')),'55000','requerimiento Atendido: tampoco el cargo');
select pg_temp.como('d1000000-0000-4000-8000-000000000004');
select pg_temp.denied(format($q$select public.editar_cabecera_requerimiento(%L,null,'AGENTE')$q$,current_setting('qa.r1')),'55000','requerimiento Atendido: ni siquiera un superadmin');
reset role;
select pg_temp.denied(format($q$update public.requerimientos set cargo='X' where id=%L$q$,current_setting('qa.r2')),'P0001','el cargo del requerimiento no se cambia por fuera de la operación');
select pg_temp.denied(format($q$update public.requerimientos set referencia_interna='RENOVACION VERANO' where id=%L$q$,current_setting('qa.r2')),'P0001','la referencia interna tampoco');
select pg_temp.denied(format($q$update public.requerimientos set agente_id=%L where id=%L$q$,'d4000000-0000-4000-8000-000000000001',current_setting('qa.r2')),'P0001','ni el agente, ni los demás campos protegidos');

\echo '--- renombrar un cargo y listados ---'
set local role authenticated;
select pg_temp.como('d1000000-0000-4000-8000-000000000001');
select public.admin_guardar_catalogo('cargos',(select id from public.cargos where nombre='SUPERVISOR'),'{"nombre":"SUPERVISOR GENERAL"}');
reset role;
select pg_temp.ok((select cargo='SUPERVISOR GENERAL' from public.personal where codigo_personal='I-1') and (select cargo='SUPERVISOR' from public.requerimientos where id=current_setting('qa.r1')::uuid),'renombrar un cargo actualiza la ficha y los requerimientos antiguos conservan su copia');
set local role authenticated;
select pg_temp.como('d1000000-0000-4000-8000-000000000002');
select pg_temp.ok((public.listar_requerimientos_filtrados()#>>'{rows,0,cargo}') is not null,'el listado propio devuelve el cargo del requerimiento');
select pg_temp.como('d1000000-0000-4000-8000-000000000001');
select pg_temp.ok((public.admin_consultar_requerimientos_v2(p_exportar=>true)#>>'{rows,0,cargo}') is not null,'administración devuelve el cargo para el detalle y los CSV');
reset role;
rollback;
