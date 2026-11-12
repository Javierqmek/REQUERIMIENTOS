-- Mantenimiento → Prendas con "set local role authenticated": la lista incluye las prendas sin asignar, cada filtro, el buscador,
-- el error de código repetido (con el id de la ficha existente), que la ficha y sus asignaciones se guardan juntas, y la exportación
-- con y sin filtros.
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
-- códigos de las prendas devueltas por la lista (con los filtros dados), ordenados
create function pg_temp.lista(variadic args text[] default '{}') returns text language plpgsql as $$
declare r jsonb; q text;
begin
  q:='select public.admin_listar_prendas('||array_to_string(args,',')||')';
  if cardinality(args)=0 then q:='select public.admin_listar_prendas()'; end if;
  execute q into r;
  return coalesce((select string_agg(x->>'codigo_prenda',',' order by x->>'codigo_prenda') from jsonb_array_elements(r->'rows') x),'')||'|'||(r->>'total');
end $$;
create function pg_temp.exporta(variadic args text[] default '{}') returns text language plpgsql as $$
declare r jsonb; q text;
begin
  q:='select public.admin_exportar_prendas('||array_to_string(args,',')||')';
  if cardinality(args)=0 then q:='select public.admin_exportar_prendas()'; end if;
  execute q into r;
  return coalesce((select string_agg((x->>'codigo_prenda')||':'||coalesce(x->>'cliente','-')||':'||coalesce(x->>'puesto','-')||':'||coalesce(x->>'genero','-'),',' order by x->>'codigo_prenda',x->>'cliente',x->>'puesto') from jsonb_array_elements(r) x),'');
end $$;

insert into auth.users(id,email,raw_user_meta_data) values
 ('b1000000-0000-4000-8000-000000000001','admin-lis@example.test','{}'),
 ('b1000000-0000-4000-8000-000000000002','coord-lis@example.test','{}');
update public.profiles set role='admin' where id='b1000000-0000-4000-8000-000000000001';
update public.profiles set role='coordinador' where id='b1000000-0000-4000-8000-000000000002';
insert into public.clientes(id,nombre,activo) values ('b2000000-0000-4000-8000-000000000001','RENIEC',true),('b2000000-0000-4000-8000-000000000002','BCR',true);
update public.clientes set diferencia_puestos=true where id='b2000000-0000-4000-8000-000000000002';
insert into public.puestos(id,cliente_id,nombre) values
 ('b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002','Vigilante Masculino'),
 ('b3000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002','Vigilante Femenino');

set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
-- 11AS001 se crea SIN asignaciones a propósito
select public.admin_guardar_catalogo('prendas',null,'{"codigo_prenda":"11AS001","nombre_prenda":"CHALECO SIN ASIGNAR","codigo_almacen":"UNF1","precio":10}');
select public.admin_guardar_catalogo('prendas',null,'{"codigo_prenda":"P-ARO","nombre_prenda":"Camiseta Árbol","codigo_almacen":"EPP","precio":20,
  "asignaciones":[{"cliente_id":"b2000000-0000-4000-8000-000000000001","renovacion":"AMBOS","genero":"HOMBRE","cantidad":1,"activo":true}]}');
select public.admin_guardar_catalogo('prendas',null,'{"codigo_prenda":"CAM-1","nombre_prenda":"CAMISA BLANCA","codigo_almacen":"UNF1","precio":30,
  "asignaciones":[{"cliente_id":"b2000000-0000-4000-8000-000000000001","renovacion":"AMBOS","genero":"HOMBRE","cantidad":2,"activo":true},
                  {"cliente_id":"b2000000-0000-4000-8000-000000000002","puesto_id":"b3000000-0000-4000-8000-000000000002","renovacion":"VERANO","genero":"MUJER","cantidad":3,"activo":true}]}');
select public.admin_guardar_catalogo('prendas',null,'{"codigo_prenda":"GOR-9","nombre_prenda":"GORRA RETIRADA","codigo_almacen":"SUE1","precio":5,
  "asignaciones":[{"cliente_id":"b2000000-0000-4000-8000-000000000001","renovacion":"INVIERNO","genero":"AMBOS","cantidad":1,"activo":true}]}');
select public.admin_guardar_catalogo('prendas',null,'{"codigo_prenda":"ZAP-0","nombre_prenda":"ZAPATO VIEJO","codigo_almacen":"PP","precio":50}');
select public.admin_actualizar_catalogo_activo('prendas',(select id from public.prendas where codigo_prenda='GOR-9'),false);
select public.admin_actualizar_catalogo_activo('prendas',(select id from public.prendas where codigo_prenda='ZAP-0'),false);

\echo '--- lista: prendas sin asignar y estado ---'
select pg_temp.ok(pg_temp.lista()='11AS001,CAM-1,P-ARO|3','por defecto (Activas): incluye 11AS001 sin asignar y excluye las inactivas');
select pg_temp.ok((select bool_and((x->>'sin_asignar')::boolean=(x->>'codigo_prenda'='11AS001')) from jsonb_array_elements(public.admin_listar_prendas()->'rows') x),'11AS001 viene marcada sin_asignar y las demás no');
select pg_temp.ok(pg_temp.lista('p_estado=>''inactivas''')='GOR-9,ZAP-0|2','Inactivas: solo las inactivas (también la sin asignar)');
select pg_temp.ok(pg_temp.lista('p_estado=>''todas''')='11AS001,CAM-1,GOR-9,P-ARO,ZAP-0|5','Todas: las 5 prendas, con y sin asignaciones');
select pg_temp.ok(pg_temp.lista('p_sin_asignar=>true')='11AS001|1','filtro Sin asignar (Activas): solo 11AS001');
select pg_temp.ok(pg_temp.lista('p_sin_asignar=>true','p_estado=>''todas''')='11AS001,ZAP-0|2','Sin asignar + Todas: también la inactiva sin asignar');
select pg_temp.ok(pg_temp.lista('p_sin_asignar=>true','p_genero=>''HOMBRE''')='|0','Sin asignar combinado con un filtro de asignación no devuelve nada');
select pg_temp.ok(jsonb_array_length(public.admin_listar_catalogo('prendas')->'rows')=5 and (public.admin_listar_catalogo('prendas')->>'total')::int=5,'la lista de Mantenimiento por la RPC general también incluye las sin asignar');

\echo '--- filtros de asignación ---'
select pg_temp.ok(pg_temp.lista('p_cliente_id=>''b2000000-0000-4000-8000-000000000001''')='CAM-1,P-ARO|2','cliente RENIEC (activas): sus prendas, sin las sin asignar');
select pg_temp.ok(pg_temp.lista('p_cliente_id=>''b2000000-0000-4000-8000-000000000002''')='CAM-1|1','cliente BCR');
select pg_temp.ok(pg_temp.lista('p_puesto_id=>''b3000000-0000-4000-8000-000000000002''')='CAM-1|1' and pg_temp.lista('p_puesto_id=>''b3000000-0000-4000-8000-000000000001''')='|0','puesto: solo las prendas con asignación en ese puesto');
select pg_temp.ok(pg_temp.lista('p_genero=>''MUJER''')='CAM-1|1' and pg_temp.lista('p_genero=>''HOMBRE''')='CAM-1,P-ARO|2' and pg_temp.lista('p_genero=>''AMBOS''')='|0','género: una prenda aparece si alguna asignación cumple');
select pg_temp.ok(pg_temp.lista('p_renovacion=>''VERANO''')='CAM-1|1' and pg_temp.lista('p_renovacion=>''AMBOS''')='CAM-1,P-ARO|2' and pg_temp.lista('p_renovacion=>''INVIERNO''')='|0','renovación: sobre las asignaciones (la inactiva GOR-9 no sale con Activas)');
select pg_temp.ok(pg_temp.lista('p_renovacion=>''INVIERNO''','p_estado=>''todas''')='GOR-9|1','renovación INVIERNO con Todas');
select pg_temp.ok(pg_temp.lista('p_cliente_id=>''b2000000-0000-4000-8000-000000000001''','p_genero=>''MUJER''')='|0','cliente + género se evalúan sobre la MISMA asignación (CAM-1 es MUJER solo en BCR, no en RENIEC)');
select pg_temp.ok(pg_temp.lista('p_cliente_id=>''b2000000-0000-4000-8000-000000000002''','p_genero=>''MUJER''','p_renovacion=>''VERANO''','p_puesto_id=>''b3000000-0000-4000-8000-000000000002''')='CAM-1|1','todos los filtros de asignación juntos sobre una misma asignación');
select pg_temp.ok(pg_temp.lista('p_almacen=>''EPP''')='P-ARO|1' and pg_temp.lista('p_almacen=>''UNF1''')='11AS001,CAM-1|2' and pg_temp.lista('p_almacen=>''PP''','p_estado=>''todas''')='ZAP-0|1','almacén: por código exacto (y combinado con estado)');
select pg_temp.ok(public.admin_listar_prendas(p_estado=>'todas')->'almacenes'='["EPP","PP","SUE1","UNF1"]'::jsonb,'la lista devuelve los códigos de almacén existentes para el filtro');

\echo '--- buscador ---'
select pg_temp.ok(pg_temp.lista('p_busqueda=>''arbol''')='P-ARO|1','busca sin tildes: "arbol" encuentra "Camiseta Árbol"');
select pg_temp.ok(pg_temp.lista('p_busqueda=>''ÁRBOL''')='P-ARO|1' and pg_temp.lista('p_busqueda=>''CAMISETA árbol''')='P-ARO|1','sin importar mayúsculas ni tildes del texto escrito');
select pg_temp.ok(pg_temp.lista('p_busqueda=>''11as''')='11AS001|1','busca por código (parcial, sin mayúsculas)');
select pg_temp.ok(pg_temp.lista('p_busqueda=>''camisa''')='CAM-1|1','busca por nombre');
select pg_temp.ok(pg_temp.lista('p_busqueda=>''epp''')='|0','no busca en el código de almacén (solo código o nombre de prenda)');
select pg_temp.ok(pg_temp.lista('p_busqueda=>''ca''','p_cliente_id=>''b2000000-0000-4000-8000-000000000001''')='CAM-1,P-ARO|2','el buscador se combina con los filtros');
select pg_temp.ok(pg_temp.lista('p_busqueda=>''c''','p_cliente_id=>''b2000000-0000-4000-8000-000000000001''','p_estado=>''todas''')='CAM-1,P-ARO|2','el contador (total) refleja los filtros aplicados');
select pg_temp.denied($q$select public.admin_listar_prendas(p_genero=>'X')$q$,'22023','género inválido');
select pg_temp.denied($q$select public.admin_listar_prendas(p_estado=>'borradas')$q$,'22023','estado inválido');
select pg_temp.denied($q$select public.admin_listar_prendas(p_renovacion=>'PRIMAVERA')$q$,'22023','renovación inválida');

\echo '--- crear: código repetido y ficha + asignaciones en una sola transacción ---'
do $$
declare v_detail text; v_hint text;
begin
  begin
    perform public.admin_guardar_catalogo('prendas',null,'{"codigo_prenda":"11as001","nombre_prenda":"OTRA","codigo_almacen":"UNF1","precio":1}');
    raise exception 'FAIL: se aceptó un código repetido';
  exception when unique_violation then
    get stacked diagnostics v_detail=pg_exception_detail, v_hint=pg_exception_hint;
    if v_detail is distinct from (select id::text from public.prendas where codigo_prenda='11AS001') or v_hint<>'prenda_existente' then
      raise exception 'FAIL: el error no trae el id de la ficha existente (%)',v_detail; end if;
    raise notice 'PASS: código repetido (sin distinguir mayúsculas): el error trae el id de la ficha existente para abrirla';
  end;
end $$;
select pg_temp.denied($q$select public.admin_guardar_catalogo('prendas',null,'{"codigo_prenda":"HUERF","nombre_prenda":"NO DEBE QUEDAR","codigo_almacen":"UNF1","precio":1,
  "asignaciones":[{"cliente_id":"b2000000-0000-4000-8000-0000000000ff","renovacion":"AMBOS","genero":"AMBOS","cantidad":1,"activo":true}]}')$q$,'P0002','una asignación inválida cancela todo el guardado');
reset role;
select pg_temp.ok(not exists(select 1 from public.prendas where codigo_prenda='HUERF'),'no queda una ficha huérfana: ficha y asignaciones se guardan en una sola transacción');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
-- asignar después una prenda que se creó sin asignaciones (editar su ficha)
select public.admin_guardar_catalogo('prendas',(select id from public.prendas where codigo_prenda='11AS001'),'{"codigo_prenda":"11AS001","nombre_prenda":"CHALECO SIN ASIGNAR","codigo_almacen":"UNF1","precio":10,
  "asignaciones":[{"cliente_id":"b2000000-0000-4000-8000-000000000001","renovacion":"AMBOS","genero":"AMBOS","cantidad":1,"activo":true}]}');
select pg_temp.ok(pg_temp.lista('p_sin_asignar=>true')='|0' and pg_temp.lista('p_cliente_id=>''b2000000-0000-4000-8000-000000000001''','p_busqueda=>''11as''')='11AS001|1','al asignarla deja de estar "sin asignar"');
-- se restablece para las pruebas de exportación
reset role;
delete from public.prenda_clientes where prenda_id=(select id from public.prendas where codigo_prenda='11AS001');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);

\echo '--- exportación con y sin filtros ---'
select pg_temp.ok(pg_temp.exporta()='11AS001:-:-:-,CAM-1:BCR:Vigilante Femenino:MUJER,CAM-1:RENIEC:-:HOMBRE,GOR-9:RENIEC:-:AMBOS,P-ARO:RENIEC:-:HOMBRE,ZAP-0:-:-:-',
  'sin filtros: todas las prendas (también inactivas y sin asignar): una fila por asignación y una fila sin cliente por cada prenda sin asignar');
select pg_temp.ok(pg_temp.exporta('p_sin_asignar=>true')='11AS001:-:-:-,ZAP-0:-:-:-','filtro Sin asignar: solo esas (activas e inactivas con Estado Todas)');
select pg_temp.ok(pg_temp.exporta('p_sin_asignar=>true','p_estado=>''activas''')='11AS001:-:-:-','Sin asignar + Activas: solo 11AS001');
select pg_temp.ok(pg_temp.exporta('p_estado=>''activas''')='11AS001:-:-:-,CAM-1:BCR:Vigilante Femenino:MUJER,CAM-1:RENIEC:-:HOMBRE,P-ARO:RENIEC:-:HOMBRE','Estado Activas: sin las inactivas');
select pg_temp.ok(pg_temp.exporta('p_cliente_id=>''b2000000-0000-4000-8000-000000000001''')='CAM-1:RENIEC:-:HOMBRE,GOR-9:RENIEC:-:AMBOS,P-ARO:RENIEC:-:HOMBRE','con cliente: solo sus asignaciones, sin filas de prendas sin asignar');
select pg_temp.ok(pg_temp.exporta('p_genero=>''MUJER''')='CAM-1:BCR:Vigilante Femenino:MUJER','con género: solo las asignaciones que lo cumplen (no la fila HOMBRE de la misma prenda)');
select pg_temp.ok(pg_temp.exporta('p_puesto_id=>''b3000000-0000-4000-8000-000000000002''')='CAM-1:BCR:Vigilante Femenino:MUJER' and pg_temp.exporta('p_renovacion=>''INVIERNO''')='GOR-9:RENIEC:-:AMBOS','con puesto o con renovación: solo las asignaciones que cumplen');
select pg_temp.ok(pg_temp.exporta('p_almacen=>''PP''')='ZAP-0:-:-:-' and pg_temp.exporta('p_almacen=>''UNF1''')='11AS001:-:-:-,CAM-1:BCR:Vigilante Femenino:MUJER,CAM-1:RENIEC:-:HOMBRE','con almacén: la ficha por código de almacén (con sus asignaciones o sin asignar)');
select pg_temp.ok(pg_temp.exporta('p_busqueda=>''arbol''')='P-ARO:RENIEC:-:HOMBRE','con búsqueda de texto (sin tildes)');
select pg_temp.ok((select count(*) from jsonb_array_elements(public.admin_exportar_prendas()) x where x->>'cliente' is null)=2,'las prendas sin asignar salen UNA sola vez');
select pg_temp.denied($q$select public.admin_exportar_prendas(null,null,false,null,'X')$q$,'22023','filtro inválido en la exportación');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
select pg_temp.denied($q$select public.admin_listar_prendas()$q$,'42501','un coordinador no puede listar prendas por Mantenimiento');
select pg_temp.denied($q$select public.admin_exportar_prendas()$q$,'42501','un coordinador no puede exportar');
reset role;
rollback;
