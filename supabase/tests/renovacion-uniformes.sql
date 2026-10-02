-- Valida, con "set local role authenticated" (nunca superusuario), el tipo de renovación
-- (Verano/Invierno) y que una prenda no se repita dentro de un requerimiento:
--  * crear_requerimiento exige renovación y solo acepta prendas de esa renovación o AMBOS;
--  * editar_prendas_requerimiento aplica la misma regla a las prendas nuevas;
--  * una prenda repetida se rechaza en servidor (RPC) y por restricción única (índice parcial);
--  * la misma prenda sí puede estar en OTRO requerimiento del mismo trabajador;
--  * superadmin puede crear/editar requerimientos (antes solo 'admin' y 'coordinador');
--  * renovación por defecto de la unidad, catálogo, importación y filtros.
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
 ('c1000000-0000-4000-8000-000000000001','coord-ren@example.test','{}'),
 ('c1000000-0000-4000-8000-000000000002','admin-ren@example.test','{}'),
 ('c1000000-0000-4000-8000-000000000003','super-ren@example.test','{}');
update public.profiles set role='coordinador' where id='c1000000-0000-4000-8000-000000000001';
update public.profiles set role='admin' where id='c1000000-0000-4000-8000-000000000002';
update public.profiles set role='superadmin' where id='c1000000-0000-4000-8000-000000000003';

insert into public.clientes(id,nombre,activo) values ('c2000000-0000-4000-8000-000000000001','REN CLIENTE',true);
insert into public.unidades(id,cliente_id,nombre,activo) values ('c3000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','REN UNIDAD SIN DEFECTO',true);
insert into public.unidades(id,cliente_id,nombre,renovacion_defecto,activo) values ('c3000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','REN UNIDAD INVIERNO','INVIERNO',true);
insert into public.personal(id,codigo_personal,nombre,dni,cargo,activo) values ('c4000000-0000-4000-8000-000000000001','REN-1','REN TRABAJADOR','44444444','AGENTE',true);
-- Sin renovación explícita: debe quedar AMBOS (migración: las prendas existentes quedan AMBOS).
insert into public.prendas(id,codigo_prenda,nombre_prenda,codigo_almacen,precio,cantidad,cliente,genero,activo) values
 ('c5000000-0000-4000-8000-000000000001','REN-A','PRENDA AMBOS','A',10,2,'REN CLIENTE','AMBOS',true),
 ('c5000000-0000-4000-8000-000000000004','REN-A2','PRENDA AMBOS 2','A2',12,1,'REN CLIENTE','AMBOS',true);
insert into public.prendas(id,codigo_prenda,nombre_prenda,codigo_almacen,precio,cantidad,cliente,genero,renovacion,activo) values
 ('c5000000-0000-4000-8000-000000000002','REN-V','PRENDA VERANO','V',20,1,'REN CLIENTE','AMBOS','VERANO',true),
 ('c5000000-0000-4000-8000-000000000003','REN-I','PRENDA INVIERNO','I',30,1,'REN CLIENTE','AMBOS','INVIERNO',true);

select pg_temp.ok((select renovacion from public.prendas where id='c5000000-0000-4000-8000-000000000001')='AMBOS','prenda sin renovación explícita queda AMBOS');
select pg_temp.ok((select renovacion_defecto from public.unidades where id='c3000000-0000-4000-8000-000000000001')='VERANO','unidad sin valor explícito: renovación por defecto VERANO');
select pg_temp.ok((select renovacion_defecto from public.unidades where id='c3000000-0000-4000-8000-000000000002')='INVIERNO','unidad configurada con INVIERNO la conserva');
select pg_temp.denied($$insert into public.prendas(codigo_prenda,nombre_prenda,codigo_almacen,precio,cantidad,cliente,genero,renovacion) values('X','X','X',1,1,'REN CLIENTE','AMBOS','OTOÑO')$$,'23514','prendas.renovacion solo admite VERANO/INVIERNO/AMBOS');
select pg_temp.denied($$update public.unidades set renovacion_defecto='AMBOS' where id='c3000000-0000-4000-8000-000000000001'$$,'23514','unidades.renovacion_defecto no admite AMBOS');

\echo '--- coordinador: crear requerimiento ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
select set_config('qa.verano',public.crear_requerimiento('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','VERANO',
  '[{"prenda_id":"c5000000-0000-4000-8000-000000000002"},{"prenda_id":"c5000000-0000-4000-8000-000000000001"}]',gen_random_uuid())::text,true);
select pg_temp.ok((select renovacion='VERANO' and referencia_interna='RENOVACION VERANO' from public.requerimientos where id=current_setting('qa.verano')::uuid),'requerimiento VERANO: guarda renovación y referencia');
select set_config('qa.invierno',public.crear_requerimiento('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000002','INVIERNO',
  '[{"prenda_id":"c5000000-0000-4000-8000-000000000003"},{"prenda_id":"c5000000-0000-4000-8000-000000000001"}]',gen_random_uuid())::text,true);
select pg_temp.ok((select renovacion='INVIERNO' and referencia_interna='RENOVACION INVIERNO' from public.requerimientos where id=current_setting('qa.invierno')::uuid),'requerimiento INVIERNO: guarda renovación y referencia');
select pg_temp.ok((select count(*)=2 from public.requerimientos where agente_id='c4000000-0000-4000-8000-000000000001'),'un trabajador puede tener más de un requerimiento');
select pg_temp.ok((select count(*)=1 from public.detalle_requerimiento d where d.requerimiento_id=current_setting('qa.verano')::uuid and d.prenda_id='c5000000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.detalle_requerimiento d where d.requerimiento_id=current_setting('qa.invierno')::uuid and d.prenda_id='c5000000-0000-4000-8000-000000000001'),
  'la misma prenda sí puede estar en otro requerimiento del mismo trabajador');
select pg_temp.denied($$select public.crear_requerimiento('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','VERANO','[{"prenda_id":"c5000000-0000-4000-8000-000000000003"}]',gen_random_uuid())$$,'22023','VERANO con una prenda INVIERNO');
select pg_temp.denied($$select public.crear_requerimiento('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','INVIERNO','[{"prenda_id":"c5000000-0000-4000-8000-000000000002"}]',gen_random_uuid())$$,'22023','INVIERNO con una prenda VERANO');
select pg_temp.denied($$select public.crear_requerimiento('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001',null,'[{"prenda_id":"c5000000-0000-4000-8000-000000000001"}]',gen_random_uuid())$$,'22023','renovación nula');
select pg_temp.denied($$select public.crear_requerimiento('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','AMBOS','[{"prenda_id":"c5000000-0000-4000-8000-000000000001"}]',gen_random_uuid())$$,'22023','el requerimiento no puede ser AMBOS');
select pg_temp.denied($$select public.crear_requerimiento('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','OTOÑO','[{"prenda_id":"c5000000-0000-4000-8000-000000000001"}]',gen_random_uuid())$$,'22023','renovación desconocida');
select pg_temp.denied($$select public.crear_requerimiento('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','VERANO','[{"prenda_id":"c5000000-0000-4000-8000-000000000001"},{"prenda_id":"c5000000-0000-4000-8000-000000000001"}]',gen_random_uuid())$$,'22023','prenda repetida dentro del mismo requerimiento (servidor)');
select pg_temp.denied($$select public.crear_requerimiento('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','{"prenda_id":"c5000000-0000-4000-8000-000000000001"}'::text::jsonb,gen_random_uuid())$$,'42883','la firma anterior sin renovación ya no existe');
select pg_temp.ok((select count(*)=2 from public.requerimientos),'los rechazos no dejan cabeceras parciales');
-- idempotencia por request_id se conserva
select pg_temp.ok(public.crear_requerimiento('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','VERANO','[{"prenda_id":"c5000000-0000-4000-8000-000000000001"}]','c9000000-0000-4000-8000-000000000001')
  = public.crear_requerimiento('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','VERANO','[{"prenda_id":"c5000000-0000-4000-8000-000000000001"}]','c9000000-0000-4000-8000-000000000001'),'mismo request_id devuelve el mismo requerimiento');
reset role;

\echo '--- restricción única (requerimiento, prenda) en la base ---'
select pg_temp.denied($$insert into public.detalle_requerimiento(requerimiento_id,prenda_id,cantidad,precio_unitario,codigo_almacen)
  values(current_setting('qa.verano')::uuid,'c5000000-0000-4000-8000-000000000001',1,10,'A')$$,'23505','duplicado activo bloqueado por el índice único');
select pg_temp.ok((select count(*)=0 from (select requerimiento_id,prenda_id from public.detalle_requerimiento where activo group by 1,2 having count(*)>1) x),'no hay prendas activas repetidas en ningún requerimiento');

\echo '--- coordinador: editar prendas ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
select set_config('qa.ver',(public.obtener_edicion_prendas(current_setting('qa.verano')::uuid)->>'version'),true);
select set_config('qa.d1',(select d.id::text from public.detalle_requerimiento d where d.requerimiento_id=current_setting('qa.verano')::uuid and d.prenda_id='c5000000-0000-4000-8000-000000000002'),true);
select set_config('qa.d2',(select d.id::text from public.detalle_requerimiento d where d.requerimiento_id=current_setting('qa.verano')::uuid and d.prenda_id='c5000000-0000-4000-8000-000000000001'),true);
select pg_temp.denied(format($q$select public.editar_prendas_requerimiento('%s','%s','[{"prenda_id":"c5000000-0000-4000-8000-000000000002","detalle_id":"%s"},{"prenda_id":"c5000000-0000-4000-8000-000000000001","detalle_id":"%s"},{"prenda_id":"c5000000-0000-4000-8000-000000000003"}]')$q$,
  current_setting('qa.verano'),current_setting('qa.ver'),current_setting('qa.d1'),current_setting('qa.d2')),'22023','agregar al editar una prenda de otra renovación');
select pg_temp.denied(format($q$select public.editar_prendas_requerimiento('%s','%s','[{"prenda_id":"c5000000-0000-4000-8000-000000000002","detalle_id":"%s"},{"prenda_id":"c5000000-0000-4000-8000-000000000002"}]')$q$,
  current_setting('qa.verano'),current_setting('qa.ver'),current_setting('qa.d1')),'22023','agregar al editar una prenda ya presente (duplicada)');
select public.editar_prendas_requerimiento(current_setting('qa.verano')::uuid,current_setting('qa.ver'),
  format('[{"prenda_id":"c5000000-0000-4000-8000-000000000002","detalle_id":"%s"},{"prenda_id":"c5000000-0000-4000-8000-000000000001","detalle_id":"%s"},{"prenda_id":"c5000000-0000-4000-8000-000000000004"}]',current_setting('qa.d1'),current_setting('qa.d2'))::jsonb);
select pg_temp.ok((select count(*)=3 from public.detalle_requerimiento where requerimiento_id=current_setting('qa.verano')::uuid and activo),'editar agrega una prenda AMBOS compatible con VERANO');
select pg_temp.ok((public.obtener_edicion_prendas(current_setting('qa.verano')::uuid)->'requerimiento'->>'renovacion')='VERANO','la edición expone la renovación del requerimiento');
reset role;

\echo '--- superadmin puede crear y editar requerimientos ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000003',true);
select set_config('qa.sup',public.crear_requerimiento('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','VERANO','[{"prenda_id":"c5000000-0000-4000-8000-000000000002"}]',gen_random_uuid())::text,true);
select pg_temp.ok((select usuario_creador_id='c1000000-0000-4000-8000-000000000003' from public.requerimientos where id=current_setting('qa.sup')::uuid),'superadmin crea requerimientos');
select pg_temp.ok((public.obtener_edicion_prendas(current_setting('qa.sup')::uuid)->>'version') is not null,'superadmin abre la edición de prendas');
select public.editar_prendas_requerimiento(current_setting('qa.sup')::uuid,(public.obtener_edicion_prendas(current_setting('qa.sup')::uuid)->>'version'),
  format('[{"prenda_id":"c5000000-0000-4000-8000-000000000002","detalle_id":"%s"},{"prenda_id":"c5000000-0000-4000-8000-000000000001"}]',
    (select d.id from public.detalle_requerimiento d where d.requerimiento_id=current_setting('qa.sup')::uuid and activo))::jsonb);
select pg_temp.ok((select count(*)=2 from public.detalle_requerimiento where requerimiento_id=current_setting('qa.sup')::uuid and activo),'superadmin edita prendas');
reset role;

\echo '--- admin: catálogo (unidades y prendas) e importación ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
select pg_temp.ok((public.admin_guardar_catalogo('unidades',null,'{"cliente_id":"c2000000-0000-4000-8000-000000000001","nombre":"REN SEDE NUEVA","renovacion_defecto":"INVIERNO"}')->'row'->>'renovacion_defecto')='INVIERNO','admin crea unidad con renovación por defecto INVIERNO');
select pg_temp.denied($$select public.admin_guardar_catalogo('unidades',null,'{"cliente_id":"c2000000-0000-4000-8000-000000000001","nombre":"REN SEDE X"}')$$,'22023','la unidad exige renovación por defecto');
select pg_temp.denied($$select public.admin_guardar_catalogo('unidades',null,'{"cliente_id":"c2000000-0000-4000-8000-000000000001","nombre":"REN SEDE Y","renovacion_defecto":"AMBOS"}')$$,'22023','la unidad no admite AMBOS');
select pg_temp.ok((public.admin_guardar_catalogo('unidades',(select id from public.unidades where nombre='REN SEDE NUEVA'),'{"cliente_id":"c2000000-0000-4000-8000-000000000001","nombre":"REN SEDE NUEVA","renovacion_defecto":"VERANO"}')->'row'->>'renovacion_defecto')='VERANO','admin edita la renovación por defecto de la unidad');
select pg_temp.ok((public.admin_guardar_catalogo('prendas',null,'{"codigo_prenda":"REN-N1","nombre_prenda":"NUEVA","codigo_almacen":"N","precio":5,"cantidad":1,"cliente_id":"c2000000-0000-4000-8000-000000000001","genero":"MUJER","renovacion":"INVIERNO"}')->'row'->>'renovacion')='INVIERNO','admin crea prenda con renovación INVIERNO');
select pg_temp.ok((public.admin_guardar_catalogo('prendas',(select id from public.prendas where codigo_prenda='REN-N1'),'{"codigo_prenda":"REN-N1","nombre_prenda":"NUEVA","codigo_almacen":"N","precio":5,"cantidad":1,"cliente_id":"c2000000-0000-4000-8000-000000000001","genero":"MUJER","renovacion":"AMBOS"}')->'row'->>'renovacion')='AMBOS','admin edita la renovación de la prenda');
select pg_temp.denied($$select public.admin_guardar_catalogo('prendas',null,'{"codigo_prenda":"REN-N2","nombre_prenda":"N","codigo_almacen":"N","precio":5,"cantidad":1,"cliente_id":"c2000000-0000-4000-8000-000000000001","genero":"MUJER"}')$$,'22023','la prenda exige renovación');
select pg_temp.denied($$select public.admin_guardar_catalogo('prendas',null,'{"codigo_prenda":"REN-N3","nombre_prenda":"N","codigo_almacen":"N","precio":5,"cantidad":1,"cliente_id":"c2000000-0000-4000-8000-000000000001","genero":"MUJER","renovacion":"OTOÑO"}')$$,'22023','la prenda rechaza una renovación desconocida');
select pg_temp.ok((select bool_and(r->>'renovacion_defecto' is not null) from jsonb_array_elements(public.admin_listar_catalogo('unidades')->'rows') r),'el listado de unidades devuelve la renovación por defecto');
select pg_temp.ok((select bool_and(r->>'renovacion' is not null) from jsonb_array_elements(public.admin_listar_catalogo('prendas')->'rows') r),'el listado de prendas devuelve la renovación');
select pg_temp.ok((public.admin_importar_catalogo('prendas','[{"codigo_prenda":"REN-IMP1","nombre_prenda":"IMP","codigo_almacen":"I","precio":10,"cantidad":1,"cliente":"REN CLIENTE","genero":"HOMBRE","renovacion":"INVIERNO","activo":true}]')->>'nuevos')::int=1,'importación crea prenda con renovación');
select pg_temp.ok((select renovacion from public.prendas where codigo_prenda='REN-IMP1')='INVIERNO','la importación guarda la renovación');
select pg_temp.denied($$select public.admin_importar_catalogo('prendas','[{"codigo_prenda":"REN-IMP2","nombre_prenda":"IMP","codigo_almacen":"I","precio":10,"cantidad":1,"cliente":"REN CLIENTE","genero":"HOMBRE","renovacion":"OTOÑO","activo":true}]')$$,'22023','importación rechaza renovación inválida');
select pg_temp.denied($$select public.admin_importar_catalogo('prendas','[{"codigo_prenda":"REN-IMP3","nombre_prenda":"IMP","codigo_almacen":"I","precio":10,"cantidad":1,"cliente":"REN CLIENTE","genero":"HOMBRE","activo":true}]')$$,'22023','importación exige la columna renovación');
reset role;

\echo '--- filtros por renovación (propios y administración) ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
select pg_temp.ok((public.listar_requerimientos_filtrados(p_renovacion=>'INVIERNO')->>'total')::int=1,'mis requerimientos: filtro INVIERNO');
select pg_temp.ok((public.listar_requerimientos_filtrados(p_renovacion=>'VERANO')->>'total')::int=2,'mis requerimientos: filtro VERANO');
select pg_temp.ok((public.listar_requerimientos_filtrados()->'rows'->0->>'renovacion') is not null,'mis requerimientos: cada fila trae su renovación');
select pg_temp.denied($$select public.listar_requerimientos_filtrados(p_renovacion=>'OTOÑO')$$,'22023','mis requerimientos: renovación inválida');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
select pg_temp.ok((public.admin_consultar_requerimientos_v2(p_renovacion=>'INVIERNO')->>'total')::int=1,'administración: filtro INVIERNO');
select pg_temp.ok((public.admin_consultar_requerimientos_v2(p_renovacion=>'VERANO')->>'total')::int=3,'administración: filtro VERANO (incluye el de superadmin)');
select pg_temp.ok((select bool_and(r->>'renovacion' in ('VERANO','INVIERNO')) from jsonb_array_elements(public.admin_consultar_requerimientos_v2(p_exportar=>true)->'rows') r),'exportación: cada fila trae renovación');
select pg_temp.denied($$select public.admin_consultar_requerimientos_v2(p_renovacion=>'AMBOS')$$,'22023','administración: renovación inválida');
reset role;

rollback;
