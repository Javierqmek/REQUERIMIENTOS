#!/bin/bash
# Prueba las propuestas de supabase/proposals/ (no son migraciones): les quita begin/commit y las incluye con \i dentro de una transacción con rollback.
cd "$(dirname "$0")/../../.."
D="${TMPDIR:-${TEMP:-/tmp}}"
sed -e '/^begin;$/d' -e '/^commit;$/d' supabase/proposals/fusionar-personal-duplicado.sql > "$D/fusion_body.sql"
sed -e '/^begin;$/d' -e '/^commit;$/d' supabase/proposals/restricciones-personal-dni.sql > "$D/restr_body.sql"
if psql -h localhost -p 55432 -U postgres -d pgtest -v ON_ERROR_STOP=1 -v body="$D/fusion_body.sql" -v restr="$D/restr_body.sql" -f supabase/proposals/fusion-personal.test.sql >/tmp/t.log 2>&1; then
  echo "OK   fusion-personal-propuesta ($(grep -c PASS /tmp/t.log) PASS)"
else echo "FAIL: $(grep -m1 -E 'ERROR|FAIL' /tmp/t.log | cut -c1-200)"; fi
