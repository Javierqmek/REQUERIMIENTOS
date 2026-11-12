"""Genera supabase/migrations/202611120001_prendas_lista_filtros.sql a partir de las definiciones VIGENTES (base local con las migraciones anteriores:
borra la migración generada y corre rebuild.sh antes de regenerar)."""
import io, subprocess, sys

PSQL = ["psql", "-h", "localhost", "-p", "55432", "-U", "postgres", "-d", "pgtest", "-At", "-c"]


def defn(sig):
    out = subprocess.run(PSQL + ["select pg_get_functiondef('%s'::regprocedure)" % sig], capture_output=True, check=True).stdout.decode("utf8")
    return out.replace(chr(13), "").strip()


def sub(text, old, new, count=1):
    n = text.count(old)
    if n != count:
        sys.exit("NO COINCIDE (%d veces, esperaba %d): %r" % (n, count, old[:140]))
    return text.replace(old, new)


def semi(t):
    return t.rstrip() + ";\n"


# Normaliza para buscar sin importar mayúsculas ni tildes (también en bases con locale C).
NORM = "lower(translate(%s,'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun'))"

# Filtros de asignación: una prenda pasa si ALGUNA asignación cumple todos a la vez.
ASIG = """exists(select 1 from public.prenda_clientes a where a.prenda_id=p.id
        and (p_cliente_id is null or a.cliente_id=p_cliente_id) and (p_puesto_id is null or a.puesto_id=p_puesto_id)
        and (p_genero is null or a.genero=p_genero) and (p_renovacion is null or a.renovacion=p_renovacion))"""

out = []
add = out.append
add("""-- Mantenimiento → Prendas: la lista incluye las prendas sin asignar, nuevos filtros y exportación que respeta los filtros.
-- Aplicar después de 202611060001. UNA sola ejecución (todo en una transacción). No modifica datos.
--
-- 1. admin_listar_prendas: lista TODAS las prendas (también sin asignaciones, marcadas sin_asignar) con búsqueda por código o nombre
--    (sin importar mayúsculas ni tildes) y filtros: cliente / sin asignar, puesto, género, renovación, almacén y estado de la prenda.
--    Género, renovación, puesto y cliente se aplican a las asignaciones: pasa la prenda si alguna asignación cumple TODOS a la vez.
--    También devuelve los códigos de almacén existentes (para el filtro). admin_listar_catalogo('prendas') delega en ella.
-- 2. admin_exportar_prendas recibe los mismos filtros (sin filtros: todas las prendas, una fila por asignación y una fila sin cliente
--    para cada prenda sin asignar; con "sin asignar": solo esas; con filtros de asignación: solo las asignaciones que cumplen).
-- 3. Crear una prenda con un código existente devuelve el id de la ficha existente (detail del error 23505) para abrirla.
-- (La ficha y sus asignaciones ya se guardan en una sola transacción: admin_guardar_catalogo es una única función.)
begin;

""")

add("""create function public.admin_listar_prendas(
  p_busqueda text default null, p_cliente_id uuid default null, p_sin_asignar boolean default false, p_puesto_id uuid default null,
  p_genero text default null, p_renovacion text default null, p_almacen text default null, p_estado text default 'activas',
  p_limite integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable set search_path=pg_catalog,public,pg_temp as $$
declare
  v_q text:=%(q)s;
  v_asig boolean:=p_cliente_id is not null or p_puesto_id is not null or p_genero is not null or p_renovacion is not null;
  v_rows jsonb; v_total integer; v_almacenes jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if length(v_q)>120 or p_limite is null or p_limite<1 or p_limite>100 or p_offset is null or p_offset<0 or p_offset>50000
    or (p_genero is not null and p_genero not in ('HOMBRE','MUJER','AMBOS'))
    or (p_renovacion is not null and p_renovacion not in ('VERANO','INVIERNO','AMBOS'))
    or p_estado is null or p_estado not in ('activas','inactivas','todas') or p_sin_asignar is null
    or (p_almacen is not null and length(p_almacen)>80) then
    raise exception 'Filtros inválidos' using errcode='22023';
  end if;
  select count(*) into v_total from public.prendas p
    where (v_q='' or position(v_q in %(n)s)>0)
      and (p_almacen is null or p.codigo_almacen=p_almacen)
      and (p_estado='todas' or (p_estado='activas')=p.activo)
      and (case when p_sin_asignar then not v_asig and not exists(select 1 from public.prenda_clientes a where a.prenda_id=p.id)
                when v_asig then %(asig)s else true end);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre_prenda,x.id),'[]') into v_rows from (
    select p.id,p.codigo_prenda,p.nombre_prenda,p.codigo_almacen,p.precio,p.activo,
      not exists(select 1 from public.prenda_clientes a where a.prenda_id=p.id) sin_asignar,
      coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'cliente_id',a.cliente_id,'cliente',c.nombre,'puesto_id',a.puesto_id,'puesto',pu.nombre,
          'renovacion',a.renovacion,'genero',a.genero,'cantidad',a.cantidad,'activo',a.activo) order by c.nombre,pu.nombre nulls first,a.renovacion)
        from public.prenda_clientes a join public.clientes c on c.id=a.cliente_id
        left join public.puestos pu on pu.id=a.puesto_id where a.prenda_id=p.id),'[]'::jsonb) asignaciones
    from public.prendas p
    where (v_q='' or position(v_q in %(n)s)>0)
      and (p_almacen is null or p.codigo_almacen=p_almacen)
      and (p_estado='todas' or (p_estado='activas')=p.activo)
      and (case when p_sin_asignar then not v_asig and not exists(select 1 from public.prenda_clientes a where a.prenda_id=p.id)
                when v_asig then %(asig)s else true end)
    order by p.nombre_prenda,p.id limit p_limite offset p_offset) x;
  select coalesce(jsonb_agg(z.codigo_almacen order by z.codigo_almacen),'[]') into v_almacenes
    from (select distinct codigo_almacen from public.prendas) z;
  return jsonb_build_object('rows',v_rows,'total',v_total,'almacenes',v_almacenes);
end $$;
revoke all on function public.admin_listar_prendas(text,uuid,boolean,uuid,text,text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.admin_listar_prendas(text,uuid,boolean,uuid,text,text,text,text,integer,integer) to authenticated;

""" % {"q": "lower(translate(btrim(coalesce(p_busqueda,'')),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun'))", "n": NORM % "p.codigo_prenda||' '||p.nombre_prenda", "asig": ASIG})

# admin_listar_catalogo('prendas') delega en admin_listar_prendas (todas las prendas, también sin asignar; estado 'todas' como antes)
t = defn("public.admin_listar_catalogo(text,text,uuid,text,integer,integer)")
a = t.index("    when 'prendas' then")
b = t.index("    when 'provincias' then")
t = t[:a] + "    when 'prendas' then\n      return public.admin_listar_prendas(p_busqueda,p_cliente_id,false,null,p_genero,null,null,'todas',p_limite,p_offset);\n" + t[b:]
add(semi(t))

# crear con código repetido: devuelve el id de la ficha existente
t = defn("private.admin_guardar_catalogo(text,uuid,jsonb)")
t = sub(t, """      if exists(select 1 from public.prendas p where lower(btrim(p.codigo_prenda))=lower(v_codigo) and p.id is distinct from p_id) then
        raise exception 'Ya existe una prenda con ese código' using errcode='23505';
      end if;""", """      select p.id into v_prenda_id from public.prendas p where lower(btrim(p.codigo_prenda))=lower(v_codigo) and p.id is distinct from p_id limit 1;
      if found then
        raise exception 'Ya existe una prenda con ese código' using errcode='23505',detail=v_prenda_id::text,hint='prenda_existente';
      end if;""")
add(semi(t))

# exportación con los mismos filtros
add("drop function public.admin_exportar_prendas(uuid);\n")
add("""create function public.admin_exportar_prendas(
  p_cliente_id uuid default null, p_busqueda text default null, p_sin_asignar boolean default false, p_puesto_id uuid default null,
  p_genero text default null, p_renovacion text default null, p_almacen text default null, p_estado text default 'todas') returns jsonb
language plpgsql stable set search_path=pg_catalog,public,pg_temp as $$
declare
  v_q text:=%(q)s;
  v_asig boolean:=p_cliente_id is not null or p_puesto_id is not null or p_genero is not null or p_renovacion is not null;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if length(v_q)>120 or (p_genero is not null and p_genero not in ('HOMBRE','MUJER','AMBOS'))
    or (p_renovacion is not null and p_renovacion not in ('VERANO','INVIERNO','AMBOS'))
    or p_estado is null or p_estado not in ('activas','inactivas','todas') or p_sin_asignar is null
    or (p_almacen is not null and length(p_almacen)>80) then
    raise exception 'Filtros inválidos' using errcode='22023';
  end if;
  if p_cliente_id is not null and not exists(select 1 from public.clientes c where c.id=p_cliente_id) then
    raise exception 'Cliente no encontrado' using errcode='P0002'; end if;
  -- Prendas que pasan los filtros de la ficha; luego una fila por asignación que cumple los filtros de asignación
  -- (todas las asignaciones, activas e inactivas, si no hay filtros de asignación) y, si no hay filtros de asignación,
  -- una fila sin cliente por cada prenda sin ninguna asignación. "Sin asignar" exporta solo estas últimas.
  return coalesce((select jsonb_agg(x.j order by x.o1,x.o2,x.o3,x.o4,x.o5) from (
    select jsonb_build_object('codigo_prenda',p.codigo_prenda,'nombre_prenda',p.nombre_prenda,'codigo_almacen',p.codigo_almacen,
        'precio',to_char(p.precio,'FM9999999990.00'),'cantidad',a.cantidad,'cliente',c.nombre,'puesto',pu.nombre,
        'genero',a.genero,'renovacion',a.renovacion,'activo',a.activo) j,
      lower(p.codigo_prenda) o1,lower(c.nombre) o2,lower(coalesce(pu.nombre,'')) o3,a.renovacion o4,a.id::text o5
    from public.prendas p join public.prenda_clientes a on a.prenda_id=p.id join public.clientes c on c.id=a.cliente_id
    left join public.puestos pu on pu.id=a.puesto_id
    where not p_sin_asignar
      and (v_q='' or position(v_q in %(n)s)>0) and (p_almacen is null or p.codigo_almacen=p_almacen)
      and (p_estado='todas' or (p_estado='activas')=p.activo)
      and (p_cliente_id is null or a.cliente_id=p_cliente_id) and (p_puesto_id is null or a.puesto_id=p_puesto_id)
      and (p_genero is null or a.genero=p_genero) and (p_renovacion is null or a.renovacion=p_renovacion)
    union all
    select jsonb_build_object('codigo_prenda',p.codigo_prenda,'nombre_prenda',p.nombre_prenda,'codigo_almacen',p.codigo_almacen,
        'precio',to_char(p.precio,'FM9999999990.00'),'cantidad',null,'cliente',null,'puesto',null,'genero',null,'renovacion',null,'activo',p.activo),
      lower(p.codigo_prenda),'','','',p.id::text
    from public.prendas p
    where not v_asig and not exists(select 1 from public.prenda_clientes a where a.prenda_id=p.id)
      and (v_q='' or position(v_q in %(n)s)>0) and (p_almacen is null or p.codigo_almacen=p_almacen)
      and (p_estado='todas' or (p_estado='activas')=p.activo)
  ) x),'[]'::jsonb);
end $$;
revoke all on function public.admin_exportar_prendas(uuid,text,boolean,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_exportar_prendas(uuid,text,boolean,uuid,text,text,text,text) to authenticated;

notify pgrst,'reload schema';
commit;
""" % {"q": "lower(translate(btrim(coalesce(p_busqueda,'')),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun'))", "n": NORM % "p.codigo_prenda||' '||p.nombre_prenda"})

io.open("supabase/migrations/202611120001_prendas_lista_filtros.sql", "w", encoding="utf8", newline="\n").write("\n".join(out))
print("ok")
