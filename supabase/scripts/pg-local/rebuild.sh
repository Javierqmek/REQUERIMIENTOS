#!/bin/bash
# Base "pgtest" nueva: bootstrap + cada migración en su propia transacción (psql -f por archivo).
cd "$(dirname "$0")/../../.."
bash supabase/scripts/pg-local/ensure.sh >/dev/null
P="psql -h localhost -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists pgtest" -c "create database pgtest" 2>&1 | grep -v NOTICE
$P -d pgtest -f supabase/scripts/pg-local/bootstrap.sql || exit 1
for f in supabase/migrations/*.sql; do
  $P -d pgtest -f "$f" >/tmp/m.log 2>&1 || { echo "MIG FAIL $f"; tail -5 /tmp/m.log; exit 1; }
done
echo MIGRATIONS-OK
