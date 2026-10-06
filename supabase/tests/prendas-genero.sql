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
insert into public.prendas(codigo_prenda,nombre_prenda,genero,codigo_almacen,precio,activo) values
 ('GEN-H','Camisa hombre',' hombre ','GH',10,true),
 ('GEN-M','Camisa mujer','mujer','GM',11,true),
 ('GEN-A1','Casaca ambos','HOMBRE /MUJER','GA1',12,true),
 ('GEN-A2','Polo ambos','HOMBRE/MUJER','GA2',13,true),
 ('GEN-A3','Gorra ambos',' unisex ','GA3',14,true),
 ('GEN-A4','Capa ambos',' ambos ','GA4',15,true);
insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,cantidad,activo) select p.id,c.id,'AMBOS',2,true from public.prendas p join public.clientes c on c.nombre='Cliente género' where p.codigo_prenda='GEN-H';
insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,cantidad,activo) select p.id,c.id,'AMBOS',3,true from public.prendas p join public.clientes c on c.nombre='Cliente género' where p.codigo_prenda='GEN-M';
insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,cantidad,activo) select p.id,c.id,'AMBOS',1,true from public.prendas p join public.clientes c on c.nombre='Cliente género' where p.codigo_prenda='GEN-A1';
insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,cantidad,activo) select p.id,c.id,'AMBOS',1,true from public.prendas p join public.clientes c on c.nombre='Cliente género' where p.codigo_prenda='GEN-A2';
insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,cantidad,activo) select p.id,c.id,'AMBOS',1,true from public.prendas p join public.clientes c on c.nombre='Cliente género' where p.codigo_prenda='GEN-A3';
insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,cantidad,activo) select p.id,c.id,'AMBOS',1,true from public.prendas p join public.clientes c on c.nombre='Cliente género' where p.codigo_prenda='GEN-A4';
select pg_temp.ok((select genero='HOMBRE' from public.prendas where codigo_prenda='GEN-H'),'trim y mayúsculas HOMBRE');
select pg_temp.ok((select genero='MUJER' from public.prendas where codigo_prenda='GEN-M'),'mayúsculas MUJER');
select pg_temp.ok((select count(*)=4 and bool_and(genero='AMBOS') from public.prendas where codigo_prenda like 'GEN-A%'),'variantes y UNISEX normalizan AMBOS');
select pg_temp.ok((select count(*)=5 from public.prendas p join public.prenda_clientes a on a.prenda_id=p.id join public.clientes c on c.id=a.cliente_id where c.nombre='Cliente género' and p.genero in ('HOMBRE','AMBOS')),'Hombre obtiene HOMBRE y todos AMBOS');
select pg_temp.ok((select count(*)=5 from public.prendas p join public.prenda_clientes a on a.prenda_id=p.id join public.clientes c on c.id=a.cliente_id where c.nombre='Cliente género' and p.genero in ('MUJER','AMBOS')),'Mujer obtiene MUJER y todos AMBOS');
select pg_temp.rejected($q$insert into public.prendas(codigo_prenda,nombre_prenda,genero,codigo_almacen,precio)
 values('GEN-X','Inválida','NIÑOS','GX',1)$q$,'rechaza género fuera del catálogo');
select pg_temp.ok((select count(*)=10 from unnest(array[
 'Comentario','Ref.Int.','Num. Real','Glosa','Num. Item','Sub. Alm.','Cod. Articulo','Des. Articulo','Cantidad Art.','Precio Art.'
]) x),'SIDIGE mantiene diez columnas (contrato documental)');
select pg_temp.ok((select relrowsecurity from pg_class where oid='public.prendas'::regclass),'RLS prendas sigue habilitada');
select pg_temp.ok(not has_function_privilege('anon','public.normalizar_genero_prenda()','EXECUTE')
 and not has_function_privilege('authenticated','public.normalizar_genero_prenda()','EXECUTE'),'trigger no expuesto como RPC');
select pg_temp.ok((select indisvalid from pg_index where indexrelid='public.prenda_clientes_cliente_renovacion_idx'::regclass),'índice de filtro válido');
rollback;
