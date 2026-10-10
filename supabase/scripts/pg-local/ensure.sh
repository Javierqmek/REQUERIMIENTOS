#!/bin/bash
# Levanta el clúster local de pruebas (puerto 55432); lo recrea si su directorio fue dañado/limpiado.
DIR="${PGLOCAL_DIR:-${TEMP:-/tmp}/pg-local-data}"
if psql -h localhost -p 55432 -U postgres -Atc "select 1" >/dev/null 2>&1; then echo PG-UP; exit 0; fi
pg_ctl -D "$DIR" stop -m immediate >/dev/null 2>&1
rm -rf "$DIR"
initdb -D "$DIR" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null 2>&1
nohup pg_ctl -D "$DIR" -l "$DIR.log" -o "-p 55432" start >/dev/null 2>&1 &
for i in 1 2 3 4 5 6 7 8 9 10; do sleep 2; psql -h localhost -p 55432 -U postgres -Atc "alter system set lc_messages='C'" >/dev/null 2>&1 && break; done
psql -h localhost -p 55432 -U postgres -Atc "select pg_reload_conf()" >/dev/null 2>&1
echo PG-RECREATED
