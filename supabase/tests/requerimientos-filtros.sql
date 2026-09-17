-- SOLO base aislada con todas las migraciones. Fixtures revertidos.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;

insert into auth.users(id,email,raw_user_meta_data) values
 ('1a000000-0000-4000-8000-000000000001','filters-owner@example.test','{}'),
 ('1a000000-0000-4000-8000-000000000002','filters-admin@example.test','{}');
update public.profiles set role='admin' where id='1a000000-0000-4000-8000-000000000002';
insert into public.clientes(id,nombre) values('5a000000-0000-4000-8000-000000000001','FILTRO CLIENTE');
insert into public.unidades(id,cliente_id,nombre) values('6a000000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-000000000001','FILTRO SEDE');
insert into public.personal(id,codigo_personal,nombre,dni,cargo) values('2a000000-0000-4000-8000-000000000001','FIL-P','AGENTE FILTRO','12345679','AGENTE');
insert into public.prendas(id,codigo_prenda,nombre_prenda,codigo_almacen,precio,cliente,cantidad,activo,genero) values
 ('3a000000-0000-4000-8000-000000000001','FIL-H','PRENDA HOMBRE','H',10,'FILTRO CLIENTE',2,true,'HOMBRE'),
 ('3a000000-0000-4000-8000-000000000002','FIL-M','PRENDA MUJER','M',20,'FILTRO CLIENTE',1,true,'MUJER'),
 ('3a000000-0000-4000-8000-000000000003','FIL-A','PRENDA UNISEX','A',30,'FILTRO CLIENTE',3,true,'AMBOS');
insert into public.requerimientos(id,agente_id,usuario_creador_id,cliente_id,unidad_id,estado,referencia_interna) values
 ('4a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-000000000001','6a000000-0000-4000-8000-000000000001','Observado','FILTRO-OBS'),
 ('4a000000-0000-4000-8000-000000000002','2a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-000000000001','6a000000-0000-4000-8000-000000000001','Pendiente','FILTRO-PEN');
insert into public.detalle_requerimiento(id,requerimiento_id,prenda_id,cantidad,precio_unitario,codigo_almacen,activo,retirado_at,retirado_por) values
 ('7a000000-0000-4000-8000-000000000001','4a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001',2,10,'H',true,null,null),
 ('7a000000-0000-4000-8000-000000000002','4a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000003',3,30,'A',true,null,null),
 ('7a000000-0000-4000-8000-000000000003','4a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000002',99,20,'M-OLD',false,now(),'1a000000-0000-4000-8000-000000000001'),
 ('7a000000-0000-4000-8000-000000000004','4a000000-0000-4000-8000-000000000002','3a000000-0000-4000-8000-000000000002',1,20,'M',true,null,null);

set local role authenticated;
select set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000001',true);
select pg_temp.ok((public.listar_requerimientos_filtrados(p_cliente_id=>'5a000000-0000-4000-8000-000000000001')#>>'{total}')::int=2,'coordinador filtra cliente');
select pg_temp.ok((public.listar_requerimientos_filtrados(p_unidad_id=>'6a000000-0000-4000-8000-000000000001')#>>'{total}')::int=2,'coordinador filtra sede');
select pg_temp.ok((public.listar_requerimientos_filtrados(p_estado=>'Observado')#>>'{total}')::int=1,'coordinador filtra Observado');
select pg_temp.ok((public.listar_requerimientos_filtrados(p_genero=>'HOMBRE')#>>'{total}')::int=1,'HOMBRE incluye HOMBRE y AMBOS');
select pg_temp.ok((public.listar_requerimientos_filtrados(p_genero=>'MUJER')#>>'{total}')::int=2,'MUJER incluye MUJER y AMBOS');
select pg_temp.ok((public.listar_requerimientos_filtrados(p_genero=>'AMBOS')#>>'{total}')::int=1,'UNISEX exige AMBOS');
select pg_temp.ok((public.listar_requerimientos_filtrados(p_prendas_min=>2,p_prendas_max=>2)#>>'{total}')::int=1,'prendas cuenta líneas activas');
select pg_temp.ok((public.listar_requerimientos_filtrados(p_unidades_min=>5,p_unidades_max=>5)#>>'{total}')::int=1,'unidades suma cantidades activas');
select pg_temp.ok((public.listar_requerimientos_filtrados(p_estado=>'Observado',p_genero=>'AMBOS',p_prendas_min=>2,p_unidades_min=>5)#>>'{total}')::int=1,'combina filtros');
select pg_temp.ok((public.listar_requerimientos_filtrados(p_estado=>'Observado')#>>'{rows,0,cantidad_prendas}')::int=2
 and (public.listar_requerimientos_filtrados(p_estado=>'Observado')#>>'{rows,0,unidades_totales}')::int=5,'inactivas no cuentan y prendas no son unidades');
select pg_temp.ok(jsonb_array_length(public.opciones_requerimientos_propios()->'clientes')=1
 and jsonb_array_length(public.opciones_requerimientos_propios()->'unidades')=1,'opciones propias sin consultas N+1');

select set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000002',true);
select pg_temp.ok((public.admin_consultar_requerimientos_v2(p_genero=>'HOMBRE',p_unidades_min=>5,p_unidades_max=>5)#>>'{total}')::int=1,'admin filtra género y unidades');
select pg_temp.ok((public.admin_consultar_requerimientos_v2(p_cliente_id=>'5a000000-0000-4000-8000-000000000001',p_estado=>'Observado',p_genero=>'AMBOS',p_unidades_min=>5)#>>'{total}')::int=1,'admin combina filtros existentes y nuevos');
rollback;
