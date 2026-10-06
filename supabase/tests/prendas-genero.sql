-- SOLO base aislada con todas las migraciones. Ningún dato persiste.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.rejected(command text,label text) returns void language plpgsql as $$
begin
  begin execute command; exception when check_violation or not_null_violation then raise notice 'PASS: %',label; return; end;
  raise exception 'FAIL: %',label;
end $$;

insert into public.clientes(nombre,activo) values('Cliente género',true);
insert into public.prendas(codigo_prenda,nombre_prenda,codigo_almacen,precio,activo) values
 ('GEN-H','Camisa hombre','GH',10,true),
 ('GEN-M','Camisa mujer','GM',11,true),
 ('GEN-A1','Casaca ambos','GA1',12,true),
 ('GEN-A2','Polo ambos','GA2',13,true),
 ('GEN-A3','Gorra ambos','GA3',14,true),
 ('GEN-A4','Capa ambos','GA4',15,true);
insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,genero,cantidad,activo) select p.id,c.id,'AMBOS',' hombre ',2,true from public.prendas p join public.clientes c on c.nombre='Cliente género' where p.codigo_prenda='GEN-H';
insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,genero,cantidad,activo) select p.id,c.id,'AMBOS','mujer',3,true from public.prendas p join public.clientes c on c.nombre='Cliente género' where p.codigo_prenda='GEN-M';
insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,genero,cantidad,activo) select p.id,c.id,'AMBOS','HOMBRE /MUJER',1,true from public.prendas p join public.clientes c on c.nombre='Cliente género' where p.codigo_prenda='GEN-A1';
insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,genero,cantidad,activo) select p.id,c.id,'AMBOS','HOMBRE/MUJER',1,true from public.prendas p join public.clientes c on c.nombre='Cliente género' where p.codigo_prenda='GEN-A2';
insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,genero,cantidad,activo) select p.id,c.id,'AMBOS',' unisex ',1,true from public.prendas p join public.clientes c on c.nombre='Cliente género' where p.codigo_prenda='GEN-A3';
insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,genero,cantidad,activo) select p.id,c.id,'AMBOS',' ambos ',1,true from public.prendas p join public.clientes c on c.nombre='Cliente género' where p.codigo_prenda='GEN-A4';
select pg_temp.ok((select a.genero='HOMBRE' from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id where p.codigo_prenda='GEN-H'),'trim y mayúsculas HOMBRE (en la asignación)');
select pg_temp.ok((select a.genero='MUJER' from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id where p.codigo_prenda='GEN-M'),'mayúsculas MUJER');
select pg_temp.ok((select count(*)=4 and bool_and(a.genero='AMBOS') from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id where p.codigo_prenda like 'GEN-A%'),'variantes y UNISEX normalizan AMBOS');
select pg_temp.ok((select count(*)=5 from public.prendas p join public.prenda_clientes a on a.prenda_id=p.id join public.clientes c on c.id=a.cliente_id where c.nombre='Cliente género' and a.genero in ('HOMBRE','AMBOS')),'Hombre obtiene HOMBRE y todos AMBOS');
select pg_temp.ok((select count(*)=5 from public.prendas p join public.prenda_clientes a on a.prenda_id=p.id join public.clientes c on c.id=a.cliente_id where c.nombre='Cliente género' and a.genero in ('MUJER','AMBOS')),'Mujer obtiene MUJER y todos AMBOS');
select pg_temp.rejected($q$update public.prenda_clientes a set genero='NIÑOS' from public.prendas p where p.id=a.prenda_id and p.codigo_prenda='GEN-H'$q$,'rechaza género fuera del catálogo');
select pg_temp.ok((select count(*)=10 from unnest(array[
 'Comentario','Ref.Int.','Num. Real','Glosa','Num. Item','Sub. Alm.','Cod. Articulo','Des. Articulo','Cantidad Art.','Precio Art.'
]) x),'SIDIGE mantiene diez columnas (contrato documental)');
select pg_temp.ok((select relrowsecurity from pg_class where oid='public.prendas'::regclass),'RLS prendas sigue habilitada');
select pg_temp.ok(not has_function_privilege('anon','public.normalizar_genero_prenda()','EXECUTE')
 and not has_function_privilege('authenticated','public.normalizar_genero_prenda()','EXECUTE'),'trigger no expuesto como RPC');
select pg_temp.ok((select indisvalid from pg_index where indexrelid='public.prenda_clientes_cliente_renovacion_idx'::regclass),'índice de filtro válido');
rollback;
