# Validar migraciones en PostgreSQL local

Scripts para aplicar TODAS las migraciones (cada archivo en su propia transacción, como el SQL Editor de Supabase) sobre
un clúster local en el puerto 55432 y correr `supabase/tests/*.sql` (que usan `set local role authenticated`).

```bash
bash supabase/scripts/pg-local/ensure.sh                       # levanta (o recrea) el clúster
bash supabase/scripts/pg-local/rebuild.sh                      # base nueva + bootstrap + todas las migraciones
bash supabase/scripts/pg-local/runtests.sh supabase/tests/*.sql
```

El directorio de datos va en `$PGLOCAL_DIR` (por defecto `$TEMP/pg-local-data`); si el sistema lo limpia, `ensure.sh` lo recrea.
Las pruebas `edicion-prendas`, `security-advisor` y `security` ya fallaban antes de esta infraestructura (supuestos obsoletos).
