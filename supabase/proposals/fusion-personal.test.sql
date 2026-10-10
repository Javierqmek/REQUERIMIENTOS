-- Prueba de las propuestas de esta carpeta (no son migraciones): fusión de personal duplicado y restricciones de DNI.
-- Se corre con supabase/scripts/pg-local/test-propuestas.sh (quita el begin/commit de las propuestas y pasa sus rutas en :body y :restr).
-- Todo dentro de una transacción con rollback.
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
 ('b1000000-0000-4000-8000-000000000001','coord-fus@example.test','{}'),
 ('b1000000-0000-4000-8000-000000000002','agente-fus@example.test','{}'),
 ('b1000000-0000-4000-8000-000000000003','agente-fus2@example.test','{}'),
 ('b1000000-0000-4000-8000-000000000004','agente-fus3@example.test','{}');
update public.profiles set role='agente' where id in ('b1000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000004');
insert into public.clientes(id,nombre) values ('b2000000-0000-4000-8000-000000000001','FUSION');
insert into public.unidades(id,cliente_id,nombre) values ('b6000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','SEDE FUS');
-- Pares: 03/59 sin cuentas · 410 (sin cuenta, se queda) / 414 (con cuenta) · 79/171 ambos con cuenta · 88 con otro DNI
insert into public.personal(id,codigo_personal,nombre,dni,cargo,activo,profile_id,email,cliente_actual_id) values
 ('b3000000-0000-4000-8000-000000000001','03','ANA UNO','25744847','AGENTE',true,null,null,null),
 ('b3000000-0000-4000-8000-000000000002','59','ANA UNO','25744847','AGENTE',true,null,null,null),
 ('b3000000-0000-4000-8000-000000000003','410','LUIS DOS','09476099','AGENTE',true,null,null,null),
 ('b3000000-0000-4000-8000-000000000004','414','LUIS DOS','09476099','AGENTE',true,'b1000000-0000-4000-8000-000000000002','agente-fus@example.test','b2000000-0000-4000-8000-000000000001'),
 ('b3000000-0000-4000-8000-000000000005','79','EVA TRES','09465989','AGENTE',true,'b1000000-0000-4000-8000-000000000003','agente-fus2@example.test',null),
 ('b3000000-0000-4000-8000-000000000006','171','EVA TRES','09465989','AGENTE',true,'b1000000-0000-4000-8000-000000000004','agente-fus3@example.test',null),
 ('b3000000-0000-4000-8000-000000000007','88','OTRO','10623260','AGENTE',true,null,null,null);

insert into public.prendas(id,codigo_prenda,nombre_prenda,codigo_almacen,precio,activo) values ('b4000000-0000-4000-8000-000000000001','FUS-A','CAMISA','ALM',12.50,true);
insert into public.requerimientos(id,agente_id,usuario_creador_id,cliente_id,unidad_id) values
 ('b5000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001'),
 ('b5000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001'),
 ('b5000000-0000-4000-8000-000000000003','b3000000-0000-4000-8000-000000000004','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001'),
 ('b5000000-0000-4000-8000-000000000004','b3000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001');
insert into public.detalle_requerimiento(requerimiento_id,prenda_id,cantidad,precio_unitario,codigo_almacen) values
 ('b5000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',2,12.5,'ALM'),
 ('b5000000-0000-4000-8000-000000000003','b4000000-0000-4000-8000-000000000001',1,12.5,'ALM');
update public.requerimientos set estado='Observado' where id='b5000000-0000-4000-8000-000000000002';

-- Foto de los datos de requerimientos y líneas, SIN agente_id
create table pg_temp.antes as select r.id, to_jsonb(r) - 'agente_id' as r,
  (select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]') from public.detalle_requerimiento d where d.requerimiento_id=r.id) as l from public.requerimientos r;

\i :body

select pg_temp.fusionar_personal('03','59') as r1 \gset
select pg_temp.ok(:'r1' = '59 -> 03: 2 requerimientos, 0 documentos, 0+0 papeletas','sin cuenta: 2 requerimientos pasan al registro 03');
select pg_temp.ok((select count(*)=3 from public.requerimientos where agente_id='b3000000-0000-4000-8000-000000000001')
  and (select count(*)=0 from public.requerimientos where agente_id='b3000000-0000-4000-8000-000000000002'),'03 tiene sus 3 requerimientos y 59 ninguno');
select pg_temp.ok((select not activo from public.personal where codigo_personal='59') and (select activo from public.personal where codigo_personal='03')
  and (select count(*)=7 from public.personal),'59 queda desactivado (no se borra)');
select pg_temp.ok((select (valores_despues->>'requerimientos')::int=2 and valores_despues->>'fusionado_en'='03' from private.admin_catalog_audit where catalogo='personal' and accion='DESACTIVAR'),'auditoría de la fusión');

select pg_temp.fusionar_personal('410','414');
select pg_temp.ok((select profile_id='b1000000-0000-4000-8000-000000000002' and email='agente-fus@example.test' and cliente_actual_id='b2000000-0000-4000-8000-000000000001' from public.personal where codigo_personal='410')
  and (select profile_id is null and email is null and cliente_actual_id is null and not activo from public.personal where codigo_personal='414'),'la cuenta del duplicado pasa al que se queda (con ella van sus capacitaciones)');
select pg_temp.ok((select agente_id='b3000000-0000-4000-8000-000000000003' from public.requerimientos where id='b5000000-0000-4000-8000-000000000003'),'el requerimiento del duplicado con cuenta ahora es de 410');

-- Los datos de los requerimientos y de sus líneas no cambian (solo agente_id)
select pg_temp.ok(not exists(select 1 from pg_temp.antes a join public.requerimientos r on r.id=a.id
  where a.r is distinct from (to_jsonb(r) - 'agente_id')
     or a.l is distinct from (select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]') from public.detalle_requerimiento d where d.requerimiento_id=r.id))
  and (select count(*) from pg_temp.antes)=(select count(*) from public.requerimientos),'ningún dato de requerimientos ni de líneas cambió salvo agente_id');
select pg_temp.ok((select estado='Observado' from public.requerimientos where id='b5000000-0000-4000-8000-000000000002'),'el estado de los requerimientos se conserva');

select pg_temp.denied($q$select pg_temp.fusionar_personal('79','171')$q$,'P0001','ambos con cuenta: se detiene');
select pg_temp.denied($q$select pg_temp.fusionar_personal('03','88')$q$,'P0001','DNI distintos: se detiene');
select pg_temp.denied($q$select pg_temp.fusionar_personal('03','NOEXISTE')$q$,'P0001','código inexistente: se detiene');
select pg_temp.denied($q$update public.requerimientos set agente_id='b3000000-0000-4000-8000-000000000007' where id='b5000000-0000-4000-8000-000000000004'$q$,'P0001','cambiar agente_id fuera de la fusión sigue prohibido');

\echo '--- restricciones (aplicables después de la fusión) ---'
update public.personal set activo=false where codigo_personal='171';  -- el par 79/171 no se fusionó en esta prueba: se desactiva solo para poder crear el índice
\i :restr
select pg_temp.ok(exists(select 1 from pg_constraint where conname='personal_dni_8_digitos' and convalidated) and exists(select 1 from pg_indexes where indexname='personal_dni_activo_uidx'),'CHECK validado e índice único creados');
select pg_temp.denied($q$insert into public.personal(codigo_personal,nombre,dni,cargo) values('X1','X','1234567','AGENTE')$q$,'23514','CHECK: DNI de 7 dígitos rechazado');
select pg_temp.denied($q$insert into public.personal(codigo_personal,nombre,dni,cargo) values('X2','X','12A45678','AGENTE')$q$,'23514','CHECK: DNI con letras rechazado');
select pg_temp.denied($q$insert into public.personal(codigo_personal,nombre,dni,cargo) values('X3','X','25744847','AGENTE')$q$,'23505','índice: segundo activo con el mismo DNI rechazado');
insert into public.personal(codigo_personal,nombre,dni,cargo,activo) values('X4','COPIA INACTIVA','25744847','AGENTE',false);
select pg_temp.ok(true,'índice: un inactivo con el mismo DNI sí se permite');
select pg_temp.denied($q$update public.personal set activo=true where codigo_personal='59'$q$,'23505','reactivar un duplicado desactivado se rechaza mientras exista el activo');

-- authenticated sigue viendo todo (la fusión no cambia permisos ni RLS)
update public.profiles set role='admin' where id='b1000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select pg_temp.ok((select count(*)=4 from public.requerimientos) and (select count(*)>=7 from public.personal),'authenticated (admin) sigue viendo requerimientos y personal');
select pg_temp.ok((select count(*)=1 from public.requerimientos r join public.personal p on p.id=r.agente_id where p.codigo_personal='410'),'y los requerimientos fusionados salen con el agente conservado');
reset role;
rollback;
