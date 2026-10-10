#!/bin/bash
# Corre cada archivo SQL contra la base pgtest y resume (OK con N PASS / FAIL con el primer error).
cd "$(dirname "$0")/../../.."
for f in "$@"; do
  if psql -h localhost -p 55432 -U postgres -d pgtest -v ON_ERROR_STOP=1 -f "$f" >/tmp/t.log 2>&1; then
    echo "OK   $f ($(grep -c 'PASS' /tmp/t.log) PASS)"
  else
    echo "FAIL $f: $(grep -m1 -E 'ERROR|FAIL' /tmp/t.log | cut -c1-170)"
  fi
done
