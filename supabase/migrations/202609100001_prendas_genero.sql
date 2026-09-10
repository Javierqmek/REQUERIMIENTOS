-- Género del maestro de prendas. Ejecutar después de 202609020006.
-- No modifica detalle_requerimiento ni datos históricos de requerimientos.
begin;

alter table public.prendas
  add column genero text not null default 'AMBOS';

create function public.normalizar_genero_prenda()
returns trigger language plpgsql
set search_path=pg_catalog,pg_temp as $$
declare v_genero text;
begin
  v_genero:=pg_catalog.upper(pg_catalog.btrim(new.genero));
  v_genero:=pg_catalog.regexp_replace(v_genero,'[[:space:]]*/[[:space:]]*','/','g');
  if v_genero in ('HOMBRE/MUJER','UNISEX') then v_genero:='AMBOS'; end if;
  new.genero:=v_genero;
  return new;
end;
$$;
revoke all on function public.normalizar_genero_prenda() from public,anon,authenticated;

create trigger normalizar_genero_prenda
before insert or update of genero on public.prendas
for each row execute function public.normalizar_genero_prenda();

alter table public.prendas add constraint prendas_genero_valido
  check (genero in ('HOMBRE','MUJER','AMBOS'));

create index prendas_cliente_genero_nombre_idx
  on public.prendas(cliente,genero,nombre_prenda,id) where activo;

comment on column public.prendas.genero is
  'Clasificación del maestro: HOMBRE, MUJER o AMBOS. Importación normaliza trim, mayúsculas, HOMBRE/MUJER y UNISEX.';

notify pgrst,'reload schema';
commit;
