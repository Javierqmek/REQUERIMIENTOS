#!/bin/bash
# Prueba la carga inicial de 202611060001 con DATOS EXISTENTES: base nueva "pgmig" con todas las migraciones anteriores,
# personal con cargos (espacios, otra capitalización, repetidos) y requerimientos; luego se aplica la migración y se verifica
# el catálogo, el relleno de requerimientos.cargo y los avisos. Uso: bash supabase/scripts/pg-local/test-migracion-cargos.sh
cd "$(dirname "$0")/../../.."
bash supabase/scripts/pg-local/ensure.sh >/dev/null
P="psql -h localhost -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists pgmig" -c "create database pgmig" 2>&1 | grep -v NOTICE
$P -d pgmig -f supabase/scripts/pg-local/bootstrap.sql || exit 1
for f in supabase/migrations/*.sql; do
  case "$f" in *202611060001*) continue;; esac
  $P -d pgmig -f "$f" >/tmp/m.log 2>&1 || { echo "MIG FAIL $f"; tail -5 /tmp/m.log; exit 1; }
done
$P -d pgmig <<'SQL'
insert into auth.users(id,email,raw_user_meta_data) values ('c1000000-0000-4000-8000-000000000001','m@example.test','{}');
insert into public.clientes(id,nombre) values ('c2000000-0000-4000-8000-000000000001','RENIEC');
insert into public.unidades(id,cliente_id,nombre) values ('c3000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','SEDE');
insert into public.personal(id,codigo_personal,nombre,dni,cargo) values
 ('c4000000-0000-4000-8000-000000000001','M-1','UNO','10000001','AGENTE'),
 ('c4000000-0000-4000-8000-000000000002','M-2','DOS','10000002','AGENTE'),
 ('c4000000-0000-4000-8000-000000000003','M-3','TRES','10000003','Agente '),
 ('c4000000-0000-4000-8000-000000000004','M-4','CUATRO','10000004','supervisor'),
 ('c4000000-0000-4000-8000-000000000005','M-5','CINCO','10000005','VIGILANTE DE PLANTA'),
 ('c4000000-0000-4000-8000-000000000006','M-6','SEIS','10000006','DESCANSERO');
insert into public.requerimientos(id,agente_id,usuario_creador_id,cliente_id,unidad_id) values
 ('c5000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001'),
 ('c5000000-0000-4000-8000-000000000002','c4000000-0000-4000-8000-000000000005','c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001');
SQL
$P -d pgmig -f supabase/migrations/202611060001_cabecera_cargos.sql 2>&1 | grep -E "NOTICE|ERROR"
$P -d pgmig <<'SQL'
create function pg_temp.ok(v boolean,l text) returns void language plpgsql as $$ begin if v is distinct from true then raise exception 'FAIL: %',l; end if; raise notice 'PASS: %',l; end $$;
select pg_temp.ok((select count(*)=6 from public.cargos),'6 cargos: AGENTE, SUPERVISOR, VIGILANTE DE PLANTA, DESCANSERO + AGENTE DIA y AGENTE NOCHE');
select pg_temp.ok((select string_agg(nombre,',' order by nombre) from public.cargos where origen='existente')='AGENTE,DESCANSERO,VIGILANTE DE PLANTA,supervisor','origen existente: lo que había en personal (Agente/AGENTE unificados, sin espacios)');
select pg_temp.ok((select string_agg(nombre,',' order by nombre) from public.cargos where origen='inicial')='AGENTE DIA,AGENTE NOCHE','origen inicial: solo los que no existían (DESCANSERO y SUPERVISOR ya estaban)');
select pg_temp.ok((select cargo='AGENTE' from public.personal where codigo_personal='M-3'),'"Agente " se unificó con AGENTE');
select pg_temp.ok((select count(*)=0 from public.personal p where not exists(select 1 from public.cargos c where c.nombre=p.cargo)),'toda la ficha de personal apunta al catálogo');
select pg_temp.ok((select r.cargo='AGENTE' from public.requerimientos r where r.id='c5000000-0000-4000-8000-000000000001') and (select r.cargo='VIGILANTE DE PLANTA' from public.requerimientos r where r.id='c5000000-0000-4000-8000-000000000002'),'los requerimientos existentes quedan con el cargo actual del trabajador');
select pg_temp.ok((select count(*)=0 from public.requerimientos where cargo is null),'ningún requerimiento queda sin cargo');
SQL
