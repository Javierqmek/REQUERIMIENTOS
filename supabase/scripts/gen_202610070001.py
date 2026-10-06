import io
M = "supabase/migrations/"
def rd(n): return io.open(M+n, encoding="utf8").read()
def grab(name, marker):
    t = rd(name); i = t.index(marker)
    j = t.index("$$;", t.index("$$", i) + 2) + 3
    return t[i:j]
def sub(text, old, new, count=1):
    assert text.count(old) == count, (old[:100], text.count(old))
    return text.replace(old, new)
def cut(text, start, end, new):
    i = text.index(start); j = text.index(end, i)
    return text[:i] + new + text[j:]

PREV = "202610060001_prendas_asignaciones_por_cliente.sql"
REN = "202610020001_renovacion_prendas_unicas.sql"
out = []
out.append("""-- Género por asignación (cliente) y cambio de precio/código de almacén con alcance elegible.
-- Aplicar después de 202610060001. UNA sola ejecución (todo en una transacción).
--
-- 1. El género va en la asignación prenda-cliente (la corbata 11UNTCPLC073 es HOMBRE para RENIEC y AMBOS para
--    INDECOPI): prenda_clientes.genero se llena con el género actual de la ficha y prendas.genero se elimina
--    (su valor anterior queda en private.prendas_genero_respaldo). El formulario, crear_requerimiento
--    (nuevo p_genero) y editar_prendas_requerimiento (p_genero opcional) validan el género de la ASIGNACIÓN.
-- 2. Las líneas de requerimiento COPIAN cantidad, precio_unitario y codigo_almacen al crearse; el NOMBRE no se
--    copia (se lee en vivo de la ficha). Cambiar el precio o el código de almacén pide un alcance:
--      ahora   = solo la ficha (los requerimientos existentes no cambian);
--      tramite = además las líneas de requerimientos Pendiente u Observado (los editables);
--      todos   = además las de Atendido (solo superadmin; puede no coincidir con lo ya cargado en SIDIGE).
--    Cada cambio queda en private.admin_catalog_audit (acción CAMBIAR_FICHA) con las líneas afectadas y sus
--    valores anteriores. Los totales se calculan en vivo, no hay nada que recalcular.
-- 3. Importación: el género actualiza la asignación del cliente sin alerta; si el archivo trae una sola renovación
--    para una prenda, reemplaza la renovación vigente (AMBOS <-> VERANO/INVIERNO) y la vista previa lo informa.
begin;

-- ===== 1. género en la asignación =====
create table private.prendas_genero_respaldo as select p.id as prenda_id,p.codigo_prenda,p.genero,now() as respaldado_at from public.prendas p;
revoke all on private.prendas_genero_respaldo from public,anon,authenticated;

alter table public.prenda_clientes add column genero text not null default 'AMBOS';
update public.prenda_clientes a set genero=p.genero from public.prendas p where p.id=a.prenda_id;
alter table public.prenda_clientes alter column genero drop default;
alter table public.prenda_clientes add constraint prenda_clientes_genero_valido check (genero in ('HOMBRE','MUJER','AMBOS'));
create trigger normalizar_genero_asignacion before insert or update of genero on public.prenda_clientes
  for each row execute function public.normalizar_genero_prenda();
drop trigger normalizar_genero_prenda on public.prendas;
alter table public.prendas drop column genero;
comment on column public.prenda_clientes.genero is 'HOMBRE, MUJER o AMBOS para ESTE cliente (una misma prenda puede ser HOMBRE para un cliente y AMBOS para otro).';

-- Ficha + asignaciones como json (auditoría y respuesta de Mantenimiento).
create or replace function private.prenda_json(p_id uuid) returns jsonb language sql stable
set search_path=pg_catalog,public,pg_temp as $$
  select to_jsonb(p.*) || jsonb_build_object('asignaciones',coalesce((
    select jsonb_agg(jsonb_build_object('id',a.id,'cliente_id',a.cliente_id,'cliente',c.nombre,'renovacion',a.renovacion,
      'genero',a.genero,'cantidad',a.cantidad,'activo',a.activo) order by c.nombre,a.renovacion)
    from public.prenda_clientes a join public.clientes c on c.id=a.cliente_id where a.prenda_id=p.id),'[]'::jsonb))
  from public.prendas p where p.id=p_id;
$$;

-- Prendas que el formulario ofrece: ahora con el género de la asignación.
create or replace function public.listar_prendas_cliente(p_cliente_id uuid,p_renovacion text)
returns table(id uuid,codigo_prenda text,nombre_prenda text,codigo_almacen text,precio numeric,genero text,
  cantidad integer,renovacion text,activo boolean)
language plpgsql stable security invoker set search_path=pg_catalog,public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_cliente_id is null or p_renovacion is null or p_renovacion not in ('VERANO','INVIERNO') then
    raise exception 'Cliente o renovación inválidos' using errcode='22023';
  end if;
  return query
    select p.id,p.codigo_prenda,p.nombre_prenda,p.codigo_almacen,p.precio,a.genero,a.cantidad,a.renovacion,p.activo
    from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id
    where a.cliente_id=p_cliente_id and a.activo and p.activo and a.renovacion in (p_renovacion,'AMBOS')
    order by p.nombre_prenda,p.id;
end $$;

-- ===== 2. impacto y aplicación de cambios de precio / código de almacén =====
alter table private.admin_catalog_audit drop constraint if exists admin_catalog_audit_accion_check;
alter table private.admin_catalog_audit add constraint admin_catalog_audit_accion_check
  check (accion in ('CREAR','EDITAR','ACTIVAR','DESACTIVAR','ELIMINAR','IMPORTAR','CAMBIAR_FICHA'));

-- Las líneas guardan una copia de precio y código de almacén; solo la función de cambio de ficha puede
-- modificarlas (marca la transacción con app.cambio_ficha). El resto del historial sigue inmutable.
""")
t = grab("202609100003_mantenimiento_importaciones_borrado_pruebas.sql", "create or replace function public.proteger_historial_detalle()")
t = sub(t, """    or new.precio_unitario is distinct from old.precio_unitario
    or new.codigo_almacen is distinct from old.codigo_almacen
""", """    or (coalesce(current_setting('app.cambio_ficha',true),'')<>'1'
      and (new.precio_unitario is distinct from old.precio_unitario or new.codigo_almacen is distinct from old.codigo_almacen))
""")
out.append(t + "\n")

out.append("""
-- Cuántas líneas/requerimientos cambiarían si el precio o el código de almacén pasan a los valores indicados.
create function private.impacto_cambio_ficha(p_prenda_id uuid,p_precio numeric,p_codigo_almacen text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_p public.prendas; v_precio boolean; v_alm boolean; v_res jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  select * into v_p from public.prendas where id=p_prenda_id;
  if not found then raise exception 'Prenda no encontrada' using errcode='P0002'; end if;
  v_precio:=p_precio is not null and p_precio is distinct from v_p.precio;
  v_alm:=p_codigo_almacen is not null and btrim(p_codigo_almacen) is distinct from v_p.codigo_almacen;
  select jsonb_build_object('precio_cambia',v_precio,'almacen_cambia',v_alm,
    'tramite',jsonb_build_object('requerimientos',count(distinct r.id) filter(where r.estado in ('Pendiente','Observado')),
      'lineas',count(*) filter(where r.estado in ('Pendiente','Observado'))),
    'todos',jsonb_build_object('requerimientos',count(distinct r.id),'lineas',count(*)))
  into v_res
  from public.detalle_requerimiento d join public.requerimientos r on r.id=d.requerimiento_id
  where d.prenda_id=p_prenda_id and d.activo
    and ((v_precio and d.precio_unitario<>p_precio) or (v_alm and d.codigo_almacen<>btrim(p_codigo_almacen)));
  return v_res;
end $$;
revoke all on function private.impacto_cambio_ficha(uuid,numeric,text) from public,anon,authenticated;
grant execute on function private.impacto_cambio_ficha(uuid,numeric,text) to authenticated;
create function public.admin_impacto_cambio_ficha(p_prenda_id uuid,p_precio numeric,p_codigo_almacen text) returns jsonb
language sql stable security invoker set search_path=pg_catalog,pg_temp as $$
  select private.impacto_cambio_ficha(p_prenda_id,p_precio,p_codigo_almacen);
$$;
revoke all on function public.admin_impacto_cambio_ficha(uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.admin_impacto_cambio_ficha(uuid,numeric,text) to authenticated;

-- Aplica precio / código de almacén / nombre a la ficha con el alcance elegido y lo audita.
create function private.aplicar_cambio_ficha(p_prenda_id uuid,p_precio numeric,p_codigo_almacen text,p_nombre text,
  p_alcance text,p_origen text) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_old public.prendas; v_precio boolean; v_alm boolean; v_nombre boolean; v_lineas jsonb:='[]'::jsonb; v_req integer:=0; v_n integer:=0;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_alcance is null or p_alcance not in ('ahora','tramite','todos') then raise exception 'Alcance inválido' using errcode='22023'; end if;
  if p_alcance='todos' and not public.is_superadmin() then
    raise exception 'Solo un superadmin puede aplicar el cambio a todos los requerimientos' using errcode='42501'; end if;
  select * into v_old from public.prendas where id=p_prenda_id for update;
  if not found then raise exception 'Prenda no encontrada' using errcode='P0002'; end if;
  v_precio:=p_precio is not null and p_precio is distinct from v_old.precio;
  v_alm:=p_codigo_almacen is not null and btrim(p_codigo_almacen) is distinct from v_old.codigo_almacen;
  v_nombre:=p_nombre is not null and btrim(p_nombre) is distinct from v_old.nombre_prenda;
  if not (v_precio or v_alm or v_nombre) then return jsonb_build_object('alcance',p_alcance,'requerimientos',0,'lineas',0); end if;
  if p_alcance<>'ahora' and (v_precio or v_alm) then
    select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'requerimiento_id',x.requerimiento_id,'estado',x.estado,
        'precio_anterior',x.precio_unitario,'codigo_almacen_anterior',x.codigo_almacen) order by x.id),'[]'::jsonb),
      count(distinct x.requerimiento_id),count(*)
    into v_lineas,v_req,v_n from (
      select d.id,d.requerimiento_id,r.estado,d.precio_unitario,d.codigo_almacen
      from public.detalle_requerimiento d join public.requerimientos r on r.id=d.requerimiento_id
      where d.prenda_id=p_prenda_id and d.activo and (p_alcance='todos' or r.estado in ('Pendiente','Observado'))
        and ((v_precio and d.precio_unitario<>p_precio) or (v_alm and d.codigo_almacen<>btrim(p_codigo_almacen)))
      for update of d) x;
    perform set_config('app.cambio_ficha','1',true);
    update public.detalle_requerimiento d set
      precio_unitario=case when v_precio then p_precio else d.precio_unitario end,
      codigo_almacen=case when v_alm then btrim(p_codigo_almacen) else d.codigo_almacen end
    where d.id in (select (e->>'id')::uuid from jsonb_array_elements(v_lineas) e);
    perform set_config('app.cambio_ficha','',true);
  end if;
  update public.prendas set precio=case when v_precio then p_precio else precio end,
    codigo_almacen=case when v_alm then btrim(p_codigo_almacen) else codigo_almacen end,
    nombre_prenda=case when v_nombre then btrim(p_nombre) else nombre_prenda end
  where id=p_prenda_id;
  insert into private.admin_catalog_audit(usuario_id,accion,catalogo,registro_id,valores_antes,valores_despues)
  values(auth.uid(),'CAMBIAR_FICHA','prendas',p_prenda_id,
    jsonb_build_object('codigo_prenda',v_old.codigo_prenda,'precio',v_old.precio,'codigo_almacen',v_old.codigo_almacen,'nombre_prenda',v_old.nombre_prenda),
    jsonb_build_object('origen',p_origen,'alcance',p_alcance,
      'precio',case when v_precio then p_precio else v_old.precio end,
      'codigo_almacen',case when v_alm then btrim(p_codigo_almacen) else v_old.codigo_almacen end,
      'nombre_prenda',case when v_nombre then btrim(p_nombre) else v_old.nombre_prenda end,
      'requerimientos_afectados',v_req,'lineas_afectadas',v_n,'lineas',v_lineas));
  return jsonb_build_object('alcance',p_alcance,'requerimientos',v_req,'lineas',v_n);
end $$;
revoke all on function private.aplicar_cambio_ficha(uuid,numeric,text,text,text,text) from public,anon,authenticated;
grant execute on function private.aplicar_cambio_ficha(uuid,numeric,text,text,text,text) to authenticated;
""")

# ===== crear_requerimiento con p_genero =====
t = grab(PREV, "create or replace function public.crear_requerimiento(")
t = sub(t, "p_detalles jsonb,p_request_id uuid\n)", "p_detalles jsonb,p_request_id uuid,p_genero text\n)")
t = sub(t, "t = 0", "t = 0", 0) if False else t
t = sub(t, "    raise exception 'Selecciona el tipo de renovación (Verano o Invierno)' using errcode='22023';\n  end if;\n",
        "    raise exception 'Selecciona el tipo de renovación (Verano o Invierno)' using errcode='22023';\n  end if;\n  if p_genero is null or p_genero not in ('HOMBRE','MUJER') then\n    raise exception 'Selecciona el género de las prendas (Hombre o Mujer)' using errcode='22023';\n  end if;\n")
t = sub(t, "      and a.renovacion in (p_renovacion,'AMBOS')\n    order by a.id for share of a,p;", "      and a.renovacion in (p_renovacion,'AMBOS') and a.genero in (p_genero,'AMBOS')\n    order by a.id for share of a,p;")
t = sub(t, "raise exception 'La prenda no corresponde al cliente ni a la renovación seleccionados, o está inactiva' using errcode='22023';",
        "raise exception 'La prenda no corresponde al cliente, la renovación ni el género seleccionados, o está inactiva' using errcode='22023';")
t = sub(t, "    join public.prenda_clientes a on a.prenda_id=p.id and a.cliente_id=p_cliente_id and a.activo\n      and a.renovacion in (p_renovacion,'AMBOS')\n    where p.id=any(v_prendas);",
        "    join public.prenda_clientes a on a.prenda_id=p.id and a.cliente_id=p_cliente_id and a.activo\n      and a.renovacion in (p_renovacion,'AMBOS') and a.genero in (p_genero,'AMBOS')\n    where p.id=any(v_prendas);")
out.append("drop function public.crear_requerimiento(uuid,uuid,uuid,text,jsonb,uuid);\n" + sub(t, "create or replace function", "create function") + "\n" + """revoke all on function public.crear_requerimiento(uuid,uuid,uuid,text,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.crear_requerimiento(uuid,uuid,uuid,text,jsonb,uuid,text) to authenticated;
""")

# ===== obtener_edicion_prendas: género de la asignación =====
t = grab(PREV, "create or replace function public.obtener_edicion_prendas")
t = sub(t, "'renovacion',coalesce(a.renovacion,v_row.renovacion)))", "'renovacion',coalesce(a.renovacion,v_row.renovacion),'genero',coalesce(a.genero,'AMBOS')))")
out.append(t + "\n")

# ===== editar_prendas_requerimiento con p_genero opcional =====
t = grab(PREV, "create or replace function public.editar_prendas_requerimiento")
t = sub(t, "(p_id uuid,p_version text,p_detalles jsonb)", "(p_id uuid,p_version text,p_detalles jsonb,p_genero text default null)")
t = sub(t, "  if p_detalles is null or jsonb_typeof(p_detalles)<>'array' then\n    raise exception 'Incluye al menos una prenda'",
        "  if p_genero is not null and p_genero not in ('HOMBRE','MUJER') then\n    raise exception 'Género inválido' using errcode='22023';\n  end if;\n  if p_detalles is null or jsonb_typeof(p_detalles)<>'array' then\n    raise exception 'Incluye al menos una prenda'")
t = sub(t, "        and a.renovacion in (v_row.renovacion,'AMBOS'))) then\n    raise exception 'La prenda no corresponde al cliente ni a la renovación del requerimiento, o está inactiva'",
        "        and a.renovacion in (v_row.renovacion,'AMBOS') and (p_genero is null or a.genero in (p_genero,'AMBOS')))) then\n    raise exception 'La prenda no corresponde al cliente, la renovación ni el género, o está inactiva'")
out.append("drop function public.editar_prendas_requerimiento(uuid,text,jsonb);\n" + sub(t, "create or replace function", "create function") + "\n" + """revoke all on function public.editar_prendas_requerimiento(uuid,text,jsonb,text) from public,anon;
grant execute on function public.editar_prendas_requerimiento(uuid,text,jsonb,text) to authenticated;
""")

# ===== admin_guardar_catalogo =====
t = grab(PREV, "create or replace function private.admin_guardar_catalogo")
t = sub(t, "v_prenda_id uuid; v_a jsonb;", "v_prenda_id uuid; v_a jsonb; v_alcance text; v_impacto jsonb; v_precio numeric; v_almacen text;")
GUARDAR = """    when 'prendas' then
      if (p_valores-'codigo_prenda'-'nombre_prenda'-'codigo_almacen'-'precio'-'asignaciones'-'alcance')<>'{}'::jsonb then
        raise exception 'Campos de prenda inválidos' using errcode='22023';
      end if;
      v_codigo:=btrim(p_valores->>'codigo_prenda'); v_nombre:=btrim(p_valores->>'nombre_prenda');
      if nullif(v_codigo,'') is null or length(v_codigo)>80 or nullif(v_nombre,'') is null or length(v_nombre)>240
        or nullif(btrim(p_valores->>'codigo_almacen'),'') is null or length(btrim(p_valores->>'codigo_almacen'))>80
        or (p_valores->>'precio')!~'^[0-9]+([.][0-9]{1,2})?$' or (p_valores->>'precio')::numeric>9999999999.99 then
        raise exception 'Revisa código, nombre, almacén y precio' using errcode='22023';
      end if;
      v_alcance:=p_valores->>'alcance';
      if v_alcance is not null and v_alcance not in ('ahora','tramite','todos') then
        raise exception 'Alcance inválido' using errcode='22023'; end if;
      if p_valores ? 'asignaciones' and (jsonb_typeof(p_valores->'asignaciones')<>'array'
        or jsonb_array_length(p_valores->'asignaciones')>200) then
        raise exception 'Las asignaciones son inválidas' using errcode='22023';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('prenda:'||lower(v_codigo),0));
      if exists(select 1 from public.prendas p where lower(btrim(p.codigo_prenda))=lower(v_codigo) and p.id is distinct from p_id) then
        raise exception 'Ya existe una prenda con ese código' using errcode='23505';
      end if;
      v_precio:=(p_valores->>'precio')::numeric; v_almacen:=btrim(p_valores->>'codigo_almacen');
      if p_id is null then
        insert into public.prendas(codigo_prenda,nombre_prenda,codigo_almacen,precio,activo)
        values(v_codigo,v_nombre,v_almacen,v_precio,true) returning id into v_prenda_id;
      else
        select p.id into v_prenda_id from public.prendas p where p.id=p_id for update;
        if v_prenda_id is null then raise exception 'Prenda no encontrada' using errcode='P0002'; end if;
        v_antes:=private.prenda_json(v_prenda_id);
        -- Precio y código de almacén se copian a las líneas: si hay líneas que cambiarían, el alcance es obligatorio.
        v_impacto:=private.impacto_cambio_ficha(v_prenda_id,v_precio,v_almacen);
        if coalesce((v_impacto->'todos'->>'lineas')::integer,0)>0 and v_alcance is null then
          raise exception 'Indica el alcance del cambio de precio o de código de almacén' using errcode='22023'; end if;
        update public.prendas set codigo_prenda=v_codigo where id=v_prenda_id;
        perform private.aplicar_cambio_ficha(v_prenda_id,v_precio,v_almacen,v_nombre,coalesce(v_alcance,'ahora'),'MANTENIMIENTO');
      end if;
      -- Asignaciones (cliente, renovación, género, cantidad, activo). Primero las que se desactivan, para que un
      -- cambio AMBOS <-> VERANO/INVIERNO en un mismo guardado no choque con la regla de convivencia.
      for v_a in select e.value from jsonb_array_elements(coalesce(p_valores->'asignaciones','[]'::jsonb)) e
        order by (e.value->>'activo')='true' loop
        if jsonb_typeof(v_a)<>'object' or (v_a-'id'-'cliente_id'-'renovacion'-'genero'-'cantidad'-'activo')<>'{}'::jsonb
          or v_a->>'renovacion' is null or v_a->>'renovacion' not in ('VERANO','INVIERNO','AMBOS')
          or v_a->>'genero' is null or v_a->>'genero' not in ('HOMBRE','MUJER','AMBOS')
          or (v_a->>'cantidad')!~'^[1-9][0-9]{0,4}$' or (v_a->>'cantidad')::integer>10000
          or jsonb_typeof(v_a->'activo')<>'boolean' then
          raise exception 'Revisa las asignaciones: cliente, renovación, género, cantidad y estado' using errcode='22023';
        end if;
        begin
          if v_a->>'id' is not null then
            update public.prenda_clientes set renovacion=v_a->>'renovacion',genero=v_a->>'genero',cantidad=(v_a->>'cantidad')::integer,activo=(v_a->>'activo')::boolean
              where id=(v_a->>'id')::uuid and prenda_id=v_prenda_id
                and (v_a->>'cliente_id' is null or cliente_id=(v_a->>'cliente_id')::uuid);
            if not found then raise exception 'Asignación no encontrada' using errcode='P0002'; end if;
          else
            begin v_cliente_id:=(v_a->>'cliente_id')::uuid;
            exception when invalid_text_representation then raise exception 'Selecciona un cliente válido' using errcode='22023'; end;
            select c.nombre,c.activo into v_cliente_nombre,v_cliente_activo from public.clientes c where c.id=v_cliente_id for share;
            if not found then raise exception 'Cliente no encontrado' using errcode='P0002'; end if;
            if not v_cliente_activo and (v_a->>'activo')::boolean then raise exception 'Selecciona un cliente activo' using errcode='55000'; end if;
            insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,genero,cantidad,activo)
              values(v_prenda_id,v_cliente_id,v_a->>'renovacion',v_a->>'genero',(v_a->>'cantidad')::integer,(v_a->>'activo')::boolean);
          end if;
        exception when unique_violation then
          raise exception 'Esa prenda ya tiene una asignación para el mismo cliente y renovación' using errcode='23505';
        end;
      end loop;
      v_despues:=private.prenda_json(v_prenda_id);

"""
t = cut(t, "    when 'prendas' then", "    when 'provincias' then", GUARDAR)
out.append(t + "\n")

# ===== admin_listar_catalogo =====
t = grab(PREV, "create or replace function public.admin_listar_catalogo")
LISTAR = """    when 'prendas' then
      select count(*) into v_total from public.prendas p where
        exists(select 1 from public.prenda_clientes a where a.prenda_id=p.id
          and (p_cliente_id is null or a.cliente_id=p_cliente_id) and (p_genero is null or a.genero=p_genero))
        and (v_q='' or position(v_q in lower(concat_ws(' ',p.codigo_prenda,p.nombre_prenda,p.codigo_almacen)))>0);
      select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre_prenda,x.id),'[]') into v_rows from (
        select p.id,p.codigo_prenda,p.nombre_prenda,p.codigo_almacen,p.precio,p.activo,
          coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'cliente_id',a.cliente_id,'cliente',c.nombre,
            'renovacion',a.renovacion,'genero',a.genero,'cantidad',a.cantidad,'activo',a.activo) order by c.nombre,a.renovacion)
            from public.prenda_clientes a join public.clientes c on c.id=a.cliente_id where a.prenda_id=p.id),'[]'::jsonb) asignaciones
        from public.prendas p where
          exists(select 1 from public.prenda_clientes a where a.prenda_id=p.id
            and (p_cliente_id is null or a.cliente_id=p_cliente_id) and (p_genero is null or a.genero=p_genero))
          and (v_q='' or position(v_q in lower(concat_ws(' ',p.codigo_prenda,p.nombre_prenda,p.codigo_almacen)))>0)
        order by p.nombre_prenda,p.id limit p_limite offset p_offset) x;
"""
t = cut(t, "    when 'prendas' then", "    when 'provincias' then", LISTAR)
out.append(t + "\n")

# ===== listados de requerimientos: el género sale de la asignación del cliente del requerimiento =====
GJOIN_OLD = "left join public.prendas g on g.id=dr.prenda_id"
GJOIN_NEW = ("left join lateral (select a.genero from public.prenda_clientes a where a.prenda_id=dr.prenda_id and a.cliente_id=r.cliente_id "
             "and a.renovacion in (r.renovacion,'AMBOS') order by a.activo desc,a.updated_at desc limit 1) g on true")
for marker in ("create function public.listar_requerimientos_filtrados", "create function public.admin_consultar_requerimientos_v2"):
    t = grab(REN, marker)
    t = sub(t, "create function", "create or replace function")
    i = t.index("array_agg(distinct g.genero)"); j = t.index(GJOIN_OLD, i)
    t = t[:j] + GJOIN_NEW + t[j+len(GJOIN_OLD):]
    out.append(t + "\n")

# ===== importación de prendas por cliente =====
out.append("""
drop function public.admin_importar_prendas(uuid,jsonb,boolean,text[],boolean);
drop function private.admin_importar_prendas(uuid,jsonb,boolean,text[],boolean);
-- p_actualizar: objeto {codigo: alcance} con alcance ahora|tramite|todos para las fichas cuyos datos (precio,
-- nombre, código de almacén) se actualizan con los del archivo. El género es de la asignación del cliente.
create function private.admin_importar_prendas(p_cliente_id uuid,p_filas jsonb,p_aplicar boolean,
  p_actualizar jsonb default '{}'::jsonb,p_reemplazar boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  v_cliente text; v_f jsonb; v_alertas jsonb; v_desactivar jsonb; v_inactivas jsonb; v_renov jsonb; v_cambios jsonb:='[]'::jsonb;
  v_antes jsonb; v_prendas_nuevas integer; v_nuevas integer; v_cantidad integer; v_genero integer; v_estado integer; v_igual integer;
  v_k text; v_v text; v_r record; v_res jsonb; v_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_cliente_id is null or p_aplicar is null or p_reemplazar is null or p_actualizar is null
    or jsonb_typeof(p_actualizar)<>'object' then raise exception 'Datos inválidos' using errcode='22023'; end if;
  for v_k,v_v in select e.key,e.value#>>'{}' from jsonb_each(p_actualizar) e loop
    if length(v_k)>80 or v_v is null or v_v not in ('ahora','tramite','todos') then
      raise exception 'Alcance inválido para %',left(v_k,80) using errcode='22023'; end if;
    if v_v='todos' and not public.is_superadmin() then
      raise exception 'Solo un superadmin puede aplicar el cambio a todos los requerimientos' using errcode='42501'; end if;
  end loop;
  select c.nombre into v_cliente from public.clientes c where c.id=p_cliente_id and c.activo for share;
  if not found then raise exception 'Selecciona un cliente activo' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('importar_prendas:'||p_cliente_id::text,0));

  select jsonb_agg(to_jsonb(x)) into v_f from private.prendas_import_filas(p_filas) x;
  drop table if exists pg_temp.imp_f; drop table if exists pg_temp.imp_repl; drop table if exists pg_temp.imp_sitio;
  create temp table imp_f on commit drop as
    select * from jsonb_to_recordset(v_f) as f(fila integer,codigo_prenda text,nombre_prenda text,codigo_almacen text,
      precio numeric,cantidad integer,genero text,renovacion text,activo boolean);
  -- Defensa: la pantalla ya marca estos errores por fila; aquí nunca se acepta algo ambiguo.
  if exists(select 1 from pg_temp.imp_f group by codigo_prenda,renovacion having count(*)>1) then
    raise exception 'El archivo repite un código con la misma renovación' using errcode='22023'; end if;
  if exists(select 1 from pg_temp.imp_f a join pg_temp.imp_f b on a.codigo_prenda=b.codigo_prenda
    and a.renovacion='AMBOS' and b.renovacion<>'AMBOS') then
    raise exception 'El archivo combina AMBOS con VERANO o INVIERNO para un mismo código' using errcode='22023'; end if;
  if exists(select 1 from pg_temp.imp_f group by codigo_prenda
    having count(distinct (nombre_prenda,codigo_almacen,precio))>1) then
    raise exception 'El archivo trae datos distintos de ficha para un mismo código' using errcode='22023'; end if;

  -- Asignaciones VIGENTES del cliente que chocan con las renovaciones que trae el archivo para ese código
  -- (AMBOS contra VERANO/INVIERNO): el archivo manda y las reemplaza. Con una sola fila en el archivo y una sola
  -- asignación vigente en conflicto, se cambia su renovación en el lugar (AMBOS -> VERANO o al revés).
  create temp table imp_repl on commit drop as
    select a.id as asignacion_id,p.codigo_prenda,p.nombre_prenda,a.renovacion as de,
      (select string_agg(distinct f.renovacion,' y ' order by f.renovacion) from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda) as a_renovacion
    from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id
    where a.cliente_id=p_cliente_id and a.activo
      and exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.renovacion<>a.renovacion
        and (a.renovacion='AMBOS' or f.renovacion='AMBOS'))
      and not exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.renovacion=a.renovacion);
  create temp table imp_sitio on commit drop as
    select r.asignacion_id,f.fila,f.renovacion as nueva
    from pg_temp.imp_repl r join pg_temp.imp_f f on f.codigo_prenda=r.codigo_prenda
    where (select count(*) from pg_temp.imp_f x where x.codigo_prenda=r.codigo_prenda)=1
      and (select count(*) from pg_temp.imp_repl y where y.codigo_prenda=r.codigo_prenda)=1
      and not exists(select 1 from public.prenda_clientes e join public.prendas pe on pe.id=e.prenda_id
        where e.cliente_id=p_cliente_id and pe.codigo_prenda=r.codigo_prenda and e.renovacion=f.renovacion);
  select coalesce(jsonb_agg(jsonb_build_object('codigo',r.codigo_prenda,'nombre',r.nombre_prenda,'de',r.de,'a',r.a_renovacion)
    order by r.codigo_prenda),'[]'::jsonb) into v_renov from pg_temp.imp_repl r;

  select count(distinct o.codigo_prenda) into v_prendas_nuevas from pg_temp.imp_f o
    where not exists(select 1 from public.prendas p where p.codigo_prenda=o.codigo_prenda);
  -- Cada fila del archivo se empareja con su asignación vigente: la de la misma renovación o la que cambia de renovación.
  select count(*) filter(where m.aid is null),
         count(*) filter(where m.aid is not null and e.cantidad<>m.cantidad),
         count(*) filter(where m.aid is not null and e.genero<>m.genero),
         count(*) filter(where m.aid is not null and e.activo<>m.activo),
         count(*) filter(where m.aid is not null and not m.en_sitio and e.cantidad=m.cantidad and e.genero=m.genero and e.activo=m.activo)
    into v_nuevas,v_cantidad,v_genero,v_estado,v_igual
    from (select o.fila,o.cantidad,o.genero,o.activo,coalesce(a.id,s.asignacion_id) as aid,(a.id is null and s.asignacion_id is not null) as en_sitio
      from pg_temp.imp_f o left join public.prendas p on p.codigo_prenda=o.codigo_prenda
      left join public.prenda_clientes a on a.prenda_id=p.id and a.cliente_id=p_cliente_id and a.renovacion=o.renovacion
      left join pg_temp.imp_sitio s on s.fila=o.fila) m
    left join public.prenda_clientes e on e.id=m.aid;

  select coalesce(jsonb_agg(jsonb_build_object('codigo',t.codigo_prenda,'nombre',t.nombre_prenda,'cambios',t.cambios,'impacto',t.impacto)
    order by t.codigo_prenda),'[]'::jsonb) into v_alertas
  from (select o.codigo_prenda,p.nombre_prenda,(select jsonb_agg(c.j) from (
      select jsonb_build_object('campo','precio','actual',p.precio::text,'archivo',o.precio::numeric(12,2)::text) j where p.precio<>o.precio
      union all select jsonb_build_object('campo','nombre_prenda','actual',p.nombre_prenda,'archivo',o.nombre_prenda) where p.nombre_prenda<>o.nombre_prenda
      union all select jsonb_build_object('campo','codigo_almacen','actual',p.codigo_almacen,'archivo',o.codigo_almacen) where p.codigo_almacen<>o.codigo_almacen) c) cambios,
      private.impacto_cambio_ficha(p.id,o.precio,o.codigo_almacen) impacto
    from (select distinct on (codigo_prenda) * from pg_temp.imp_f order by codigo_prenda,fila) o
    join public.prendas p on p.codigo_prenda=o.codigo_prenda) t where t.cambios is not null;

  select coalesce(jsonb_agg(distinct o.codigo_prenda),'[]'::jsonb) into v_inactivas from pg_temp.imp_f o
    join public.prendas p on p.codigo_prenda=o.codigo_prenda where not p.activo;

  select coalesce(jsonb_agg(jsonb_build_object('codigo',p.codigo_prenda,'nombre',p.nombre_prenda,'renovacion',a.renovacion,
    'cantidad',a.cantidad) order by p.codigo_prenda,a.renovacion),'[]'::jsonb) into v_desactivar
  from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id
  where p_reemplazar and a.cliente_id=p_cliente_id and a.activo
    and not exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.renovacion=a.renovacion)
    and not exists(select 1 from pg_temp.imp_sitio s where s.asignacion_id=a.id);

  if p_aplicar then
    select coalesce(jsonb_agg(jsonb_build_object('codigo',p.codigo_prenda,'renovacion',a.renovacion,'genero',a.genero,'cantidad',a.cantidad,'activo',a.activo)
      order by p.codigo_prenda,a.renovacion),'[]'::jsonb) into v_antes
    from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id
    where a.cliente_id=p_cliente_id and (p_reemplazar or exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda));

    insert into public.prendas(codigo_prenda,nombre_prenda,codigo_almacen,precio,activo)
      select distinct on (o.codigo_prenda) o.codigo_prenda,o.nombre_prenda,o.codigo_almacen,o.precio,true
      from pg_temp.imp_f o where not exists(select 1 from public.prendas p where p.codigo_prenda=o.codigo_prenda)
      order by o.codigo_prenda,o.fila;
    -- Fichas existentes: solo las elegidas, con su alcance (precio/código de almacén se copian a las líneas).
    for v_r in select o.codigo_prenda,o.nombre_prenda,o.codigo_almacen,o.precio,p.id,e.value#>>'{}' as alcance
      from (select distinct on (codigo_prenda) * from pg_temp.imp_f order by codigo_prenda,fila) o
      join public.prendas p on p.codigo_prenda=o.codigo_prenda
      join jsonb_each(p_actualizar) e on e.key=o.codigo_prenda loop
      v_res:=private.aplicar_cambio_ficha(v_r.id,v_r.precio,v_r.codigo_almacen,v_r.nombre_prenda,v_r.alcance,'IMPORTAR');
      v_cambios:=v_cambios||jsonb_build_array(jsonb_build_object('codigo',v_r.codigo_prenda,'alcance',v_r.alcance,
        'requerimientos',v_res->'requerimientos','lineas',v_res->'lineas'));
    end loop;
    -- Orden: cambios de renovación en el lugar y desactivaciones primero; luego altas y activaciones.
    update public.prenda_clientes a set renovacion=s.nueva,cantidad=o.cantidad,genero=o.genero,activo=o.activo
      from pg_temp.imp_sitio s join pg_temp.imp_f o on o.fila=s.fila where a.id=s.asignacion_id;
    update public.prenda_clientes a set activo=false from pg_temp.imp_repl r
      where a.id=r.asignacion_id and not exists(select 1 from pg_temp.imp_sitio s where s.asignacion_id=r.asignacion_id);
    update public.prenda_clientes a set activo=false from pg_temp.imp_f o, public.prendas p
      where p.codigo_prenda=o.codigo_prenda and a.prenda_id=p.id and a.cliente_id=p_cliente_id
        and a.renovacion=o.renovacion and not o.activo and a.activo;
    update public.prenda_clientes a set activo=false from public.prendas p
      where p_reemplazar and p.id=a.prenda_id and a.cliente_id=p_cliente_id and a.activo
        and not exists(select 1 from pg_temp.imp_f f where f.codigo_prenda=p.codigo_prenda and f.renovacion=a.renovacion)
        and not exists(select 1 from pg_temp.imp_sitio s where s.asignacion_id=a.id);
    insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,genero,cantidad,activo)
      select p.id,p_cliente_id,o.renovacion,o.genero,o.cantidad,false from pg_temp.imp_f o
      join public.prendas p on p.codigo_prenda=o.codigo_prenda where not o.activo
      on conflict (prenda_id,cliente_id,renovacion) do update set cantidad=excluded.cantidad,genero=excluded.genero;
    insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,genero,cantidad,activo)
      select p.id,p_cliente_id,o.renovacion,o.genero,o.cantidad,true from pg_temp.imp_f o
      join public.prendas p on p.codigo_prenda=o.codigo_prenda where o.activo
      on conflict (prenda_id,cliente_id,renovacion) do update set cantidad=excluded.cantidad,genero=excluded.genero,activo=true;

    insert into private.admin_catalog_audit(usuario_id,accion,catalogo,registro_id,valores_antes,valores_despues)
    values(auth.uid(),'IMPORTAR','prendas',p_cliente_id,v_antes,jsonb_build_object('cliente',v_cliente,'reemplazar',p_reemplazar,
      'actualizar_fichas',p_actualizar,'cambios_ficha',v_cambios,'prendas_nuevas',v_prendas_nuevas,'asignaciones_nuevas',v_nuevas,
      'cantidades_actualizadas',v_cantidad,'generos_actualizados',v_genero,'renovaciones_actualizadas',v_renov,
      'estados_actualizados',v_estado,'desactivadas',jsonb_array_length(v_desactivar),
      'filas',(select coalesce(jsonb_agg(jsonb_build_object('codigo',o.codigo_prenda,'renovacion',o.renovacion,'genero',o.genero,'cantidad',o.cantidad,'activo',o.activo)
        order by o.fila),'[]'::jsonb) from pg_temp.imp_f o)));
  end if;

  return jsonb_build_object('aplicado',p_aplicar,'cliente',v_cliente,'prendas_nuevas',v_prendas_nuevas,
    'asignaciones_nuevas',v_nuevas,'cantidades_actualizadas',v_cantidad,'generos_actualizados',v_genero,
    'estados_actualizados',v_estado,'sin_cambios',v_igual,'renovaciones_actualizadas',v_renov,
    'alertas',v_alertas,'desactivar',v_desactivar,'fichas_inactivas',v_inactivas,'cambios_ficha',v_cambios);
end $$;
revoke all on function private.admin_importar_prendas(uuid,jsonb,boolean,jsonb,boolean) from public,anon,authenticated;
grant execute on function private.admin_importar_prendas(uuid,jsonb,boolean,jsonb,boolean) to authenticated;
create function public.admin_importar_prendas(p_cliente_id uuid,p_filas jsonb,p_aplicar boolean default false,
  p_actualizar jsonb default '{}'::jsonb,p_reemplazar boolean default false) returns jsonb
language sql volatile security invoker set search_path=pg_catalog,pg_temp as $$
  select private.admin_importar_prendas(p_cliente_id,p_filas,p_aplicar,p_actualizar,p_reemplazar);
$$;
revoke all on function public.admin_importar_prendas(uuid,jsonb,boolean,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.admin_importar_prendas(uuid,jsonb,boolean,jsonb,boolean) to authenticated;

notify pgrst,'reload schema';
commit;
""")
io.open(M+"202610070001_genero_en_asignacion_alcance_precio.sql","w",encoding="utf8",newline="\n").write("\n".join(out))
print("ok")
