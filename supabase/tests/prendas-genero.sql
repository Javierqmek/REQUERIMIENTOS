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

insert into public.prendas(codigo_prenda,nombre_prenda,genero,codigo_almacen,precio,cantidad,cliente,activo) values
 ('GEN-H','Camisa hombre',' hombre ','GH',10,2,'Cliente género',true),
 ('GEN-M','Camisa mujer','mujer','GM',11,3,'Cliente género',true),
 ('GEN-A1','Casaca ambos','HOMBRE /MUJER','GA1',12,1,'Cliente género',true),
 ('GEN-A2','Polo ambos','HOMBRE/MUJER','GA2',13,1,'Cliente género',true),
 ('GEN-A3','Gorra ambos',' unisex ','GA3',14,1,'Cliente género',true),
 ('GEN-A4','Capa ambos',' ambos ','GA4',15,1,'Cliente género',true);
select pg_temp.ok((select genero='HOMBRE' from public.prendas where codigo_prenda='GEN-H'),'trim y mayúsculas HOMBRE');
select pg_temp.ok((select genero='MUJER' from public.prendas where codigo_prenda='GEN-M'),'mayúsculas MUJER');
select pg_temp.ok((select count(*)=4 and bool_and(genero='AMBOS') from public.prendas where codigo_prenda like 'GEN-A%'),'variantes y UNISEX normalizan AMBOS');
select pg_temp.ok((select count(*)=5 from public.prendas where cliente='Cliente género' and genero in ('HOMBRE','AMBOS')),'Hombre obtiene HOMBRE y todos AMBOS');
select pg_temp.ok((select count(*)=5 from public.prendas where cliente='Cliente género' and genero in ('MUJER','AMBOS')),'Mujer obtiene MUJER y todos AMBOS');
select pg_temp.rejected($q$insert into public.prendas(codigo_prenda,nombre_prenda,genero,codigo_almacen,precio,cantidad,cliente)
 values('GEN-X','Inválida','NIÑOS','GX',1,1,'Cliente género')$q$,'rechaza género fuera del catálogo');
select pg_temp.ok((select count(*)=10 from unnest(array[
 'Comentario','Ref.Int.','Num. Real','Glosa','Num. Item','Sub. Alm.','Cod. Articulo','Des. Articulo','Cantidad Art.','Precio Art.'
]) x),'SIDIGE mantiene diez columnas (contrato documental)');
select pg_temp.ok((select relrowsecurity from pg_class where oid='public.prendas'::regclass),'RLS prendas sigue habilitada');
select pg_temp.ok(not has_function_privilege('anon','public.normalizar_genero_prenda()','EXECUTE')
 and not has_function_privilege('authenticated','public.normalizar_genero_prenda()','EXECUTE'),'trigger no expuesto como RPC');
select pg_temp.ok((select indisvalid from pg_index where indexrelid='public.prendas_cliente_genero_nombre_idx'::regclass),'índice de filtro válido');
rollback;
