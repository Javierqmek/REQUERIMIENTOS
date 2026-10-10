-- DNI estricto: 8 dígitos numéricos, sin completar ceros ni emparejar DNI "sin cero inicial".
-- Aplicar después de 202610100001. UNA sola ejecución (transacción única).
--  * Importar personal: ya no se completan ceros (la pantalla marca error con fila, nombre, DNI tal como vino y motivo).
--    El emparejamiento por DNI es exacto. Si un DNI está en la base más de una vez, se usa el registro ACTIVO (si hay
--    exactamente uno); solo es error si hay varios activos o varios inactivos sin activo.
--  * Mantenimiento: crear/editar personal exige DNI de exactamente 8 dígitos (antes 8 a 12).
-- No modifica datos. Ver supabase/proposals/ para la fusión de duplicados y las restricciones CHECK/UNIQUE (aún no aplicadas).
begin;

create or replace function private.admin_importar_personal(p_filas jsonb,p_aplicar boolean,
  p_actualizar jsonb default '[]'::jsonb,p_cargo_defecto text default 'AGENTE')
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  v_cargo text:=btrim(coalesce(p_cargo_defecto,''));
  v_nuevos integer; v_igual integer; v_dif jsonb; v_err jsonb; v_antes jsonb; v_creados jsonb:='[]'::jsonb; v_act integer:=0;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_aplicar is null or p_actualizar is null or jsonb_typeof(p_actualizar)<>'array' or jsonb_array_length(p_actualizar)>5000
    or v_cargo='' or length(v_cargo)>120 then raise exception 'Datos inválidos' using errcode='22023'; end if;
  if p_filas is null or jsonb_typeof(p_filas)<>'array' or jsonb_array_length(p_filas)<1 or jsonb_array_length(p_filas)>5000
    or octet_length(p_filas::text)>3145728 then raise exception 'Importación inválida (1 a 5000 filas)' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_filas) e where jsonb_typeof(e.value)<>'object'
      or (e.value-'fila'-'codigo_personal'-'nombre'-'dni'-'cargo'-'activo')<>'{}'::jsonb
      or (e.value->>'fila')!~'^[1-9][0-9]{0,6}$'
      or nullif(btrim(e.value->>'codigo_personal'),'') is null or length(btrim(e.value->>'codigo_personal'))>80
      or nullif(btrim(e.value->>'nombre'),'') is null or length(btrim(e.value->>'nombre'))>200
      or coalesce(e.value->>'dni','')!~'^[0-9]{8}$'
      or (e.value->>'cargo' is not null and length(btrim(e.value->>'cargo'))>120)
      or jsonb_typeof(e.value->'activo')<>'boolean') then
    raise exception 'Hay filas de personal inválidas (la pantalla las valida con su número de fila)' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('importar_personal',0));

  drop table if exists pg_temp.imp_p; drop table if exists pg_temp.imp_mt; drop table if exists pg_temp.imp_e;
  create temp table imp_p on commit drop as
    select (e.value->>'fila')::integer as fila,btrim(e.value->>'codigo_personal') as codigo,regexp_replace(btrim(e.value->>'nombre'),'\s+',' ','g') as nombre,
      e.value->>'dni' as dni,nullif(btrim(coalesce(e.value->>'cargo','')),'') as cargo,(e.value->'activo')::boolean as activo
    from jsonb_array_elements(p_filas) e;
  -- Defensa: la pantalla ya marca estos errores por fila; aquí nunca se acepta algo ambiguo.
  if exists(select 1 from pg_temp.imp_p group by dni having count(*)>1) then
    raise exception 'El archivo repite un DNI' using errcode='22023'; end if;
  if exists(select 1 from pg_temp.imp_p group by codigo having count(*)>1) then
    raise exception 'El archivo repite un código de personal' using errcode='22023'; end if;

  -- Emparejar por DNI (los guardados con menos de 8 dígitos se completan con ceros para comparar).
  create temp table imp_mt on commit drop as
    select p.fila,p.codigo,p.nombre,p.dni,p.cargo,p.activo,per.id as pid,per.codigo_personal as c_act,per.nombre as n_act,
      per.cargo as cargo_act,per.activo as act_act,per.dni as dni_act,(per.profile_id is not null) as vinculado,
      count(per.id) over (partition by p.fila) as n
    from pg_temp.imp_p p left join public.personal per
      on per.dni=p.dni and (per.activo or not exists(select 1 from public.personal x where x.dni=p.dni and x.activo));
  create temp table imp_e on commit drop as
    select distinct m.fila,m.codigo,
      case when m.n>1 then 'El DNI '||m.dni||' está repetido en la base de datos ('||m.n||' registros del mismo estado): fusiona los duplicados antes de importar'
        else 'El código '||m.codigo||' ya pertenece a otra persona (DNI '||x.dni||')' end as mensaje
    from pg_temp.imp_mt m
    left join public.personal x on x.codigo_personal=m.codigo and x.id is distinct from m.pid
    where m.n>1 or x.id is not null;
  select coalesce(jsonb_agg(jsonb_build_object('fila',e.fila,'codigo',e.codigo,'mensaje',e.mensaje) order by e.fila),'[]'::jsonb)
    into v_err from pg_temp.imp_e e;

  select count(*) filter(where m.pid is null),
         count(*) filter(where m.pid is not null and m.c_act=m.codigo and lower(regexp_replace(btrim(m.n_act),'\s+',' ','g'))=lower(m.nombre)
           and (m.cargo is null or lower(btrim(m.cargo_act))=lower(m.cargo)) and m.act_act=m.activo)
    into v_nuevos,v_igual from pg_temp.imp_mt m where m.n<=1 and not exists(select 1 from pg_temp.imp_e e where e.fila=m.fila);

  -- Existentes con datos distintos: valor actual y del archivo (no se cambian salvo que se pida).
  select coalesce(jsonb_agg(jsonb_build_object('fila',d.fila,'dni',d.dni,'nombre',d.n_act,'codigo_personal',d.c_act,'vinculado',d.vinculado,
    'cambios',d.cambios) order by d.fila),'[]'::jsonb) into v_dif
  from (select m.fila,m.dni,m.n_act,m.c_act,m.vinculado,(select jsonb_agg(c.j) from (
      select jsonb_build_object('campo','codigo_personal','actual',m.c_act,'archivo',m.codigo) j where m.c_act<>m.codigo
      union all select jsonb_build_object('campo','nombre','actual',m.n_act,'archivo',m.nombre) where lower(regexp_replace(btrim(m.n_act),'\s+',' ','g'))<>lower(m.nombre)
      union all select jsonb_build_object('campo','cargo','actual',m.cargo_act,'archivo',m.cargo) where m.cargo is not null and lower(btrim(m.cargo_act))<>lower(m.cargo)
      union all select jsonb_build_object('campo','activo','actual',case when m.act_act then 'Activo' else 'Inactivo' end,'archivo',case when m.activo then 'Activo' else 'Inactivo' end) where m.act_act<>m.activo) c) cambios
    from pg_temp.imp_mt m where m.n=1 and not exists(select 1 from pg_temp.imp_e e where e.fila=m.fila)) d where d.cambios is not null;

  if p_aplicar then
    select coalesce(jsonb_agg(jsonb_build_object('id',per.id,'dni',per.dni,'codigo_personal',per.codigo_personal,'nombre',per.nombre,
      'cargo',per.cargo,'activo',per.activo) order by per.codigo_personal),'[]'::jsonb) into v_antes
    from public.personal per where per.id in (select m.pid from pg_temp.imp_mt m where m.n=1 and m.dni in (select x#>>'{}' from jsonb_array_elements(p_actualizar) x));
    with ins as (
      insert into public.personal(codigo_personal,nombre,dni,cargo,activo)
      select m.codigo,m.nombre,m.dni,coalesce(m.cargo,v_cargo),m.activo from pg_temp.imp_mt m
      where m.pid is null and not exists(select 1 from pg_temp.imp_e e where e.fila=m.fila)
      returning id,codigo_personal,dni)
    select coalesce(jsonb_agg(jsonb_build_object('codigo_personal',i.codigo_personal,'dni',i.dni)),'[]'::jsonb) into v_creados from ins i;
    -- Actualización explícita: solo nombre, código, dni, cargo (si el archivo lo trae) y estado. Jamás profile_id,
    -- email ni cliente_actual_id.
    update public.personal per set codigo_personal=m.codigo,nombre=m.nombre,dni=m.dni,cargo=coalesce(m.cargo,per.cargo),activo=m.activo
      from pg_temp.imp_mt m
      where per.id=m.pid and m.n=1 and not exists(select 1 from pg_temp.imp_e e where e.fila=m.fila)
        and m.dni in (select x#>>'{}' from jsonb_array_elements(p_actualizar) x)
        and (m.c_act<>m.codigo or lower(regexp_replace(btrim(m.n_act),'\s+',' ','g'))<>lower(m.nombre)
          or (m.cargo is not null and lower(btrim(m.cargo_act))<>lower(m.cargo)) or m.act_act<>m.activo);
    get diagnostics v_act=row_count;
    insert into private.admin_catalog_audit(usuario_id,accion,catalogo,registro_id,valores_antes,valores_despues)
    values(auth.uid(),'IMPORTAR','personal',auth.uid(),v_antes,jsonb_build_object('filas',jsonb_array_length(p_filas),
      'nuevos',jsonb_array_length(v_creados),'creados',v_creados,'sin_cambios',v_igual,'con_diferencias',jsonb_array_length(v_dif),
      'actualizados',v_act,'actualizar_dnis',p_actualizar,'errores',jsonb_array_length(v_err),'cargo_defecto',v_cargo));
  end if;

  return jsonb_build_object('aplicado',p_aplicar,'nuevos',v_nuevos,'sin_cambios',v_igual,'diferencias',v_dif,'errores',v_err,
    'actualizados',v_act);
end $$;

create or replace function private.admin_guardar_catalogo(p_catalogo text,p_id uuid,p_valores jsonb)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_antes jsonb; v_despues jsonb; v_nombre text; v_codigo text;
  v_cliente_id uuid; v_cliente_nombre text; v_cliente_activo boolean; v_prenda_id uuid; v_a jsonb; v_alcance text; v_impacto jsonb; v_precio numeric; v_almacen text;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_catalogo not in ('clientes','unidades','personal','prendas','provincias') or p_valores is null
    or jsonb_typeof(p_valores)<>'object' then raise exception 'Datos inválidos' using errcode='22023'; end if;

  case p_catalogo
    when 'clientes' then
      if (p_valores-'nombre')<>'{}'::jsonb then raise exception 'Campos de cliente inválidos' using errcode='22023'; end if;
      v_nombre:=btrim(p_valores->>'nombre');
      if nullif(v_nombre,'') is null or length(v_nombre)>200 or v_nombre~'[\u0000-\u001f]' then
        raise exception 'El nombre del cliente es obligatorio y admite hasta 200 caracteres' using errcode='22023';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('cliente:'||lower(v_nombre),0));
      if exists(select 1 from public.clientes c where lower(btrim(c.nombre))=lower(v_nombre) and c.id is distinct from p_id) then
        raise exception 'Ya existe un cliente con ese nombre' using errcode='23505';
      end if;
      if p_id is null then
        insert into public.clientes(nombre,activo) values(v_nombre,true) returning to_jsonb(clientes.*) into v_despues;
      else
        select to_jsonb(c.*) into v_antes from public.clientes c where c.id=p_id for update;
        if v_antes is null then raise exception 'Cliente no encontrado' using errcode='P0002'; end if;
        update public.clientes set nombre=v_nombre where id=p_id returning to_jsonb(clientes.*) into v_despues;
      end if;

    when 'unidades' then
      if (p_valores-'nombre'-'cliente_id'-'renovacion_defecto')<>'{}'::jsonb then raise exception 'Campos de unidad inválidos' using errcode='22023'; end if;
      if p_valores->>'renovacion_defecto' is null or p_valores->>'renovacion_defecto' not in ('VERANO','INVIERNO') then
        raise exception 'La renovación por defecto debe ser Verano o Invierno' using errcode='22023';
      end if;
      v_nombre:=btrim(p_valores->>'nombre');
      begin v_cliente_id:=(p_valores->>'cliente_id')::uuid;
      exception when invalid_text_representation then raise exception 'Selecciona un cliente válido' using errcode='22023'; end;
      if nullif(v_nombre,'') is null or length(v_nombre)>200 or v_nombre~'[\u0000-\u001f]' then
        raise exception 'El nombre de la unidad es obligatorio y admite hasta 200 caracteres' using errcode='22023';
      end if;
      select c.nombre,c.activo into v_cliente_nombre,v_cliente_activo from public.clientes c where c.id=v_cliente_id for share;
      if not found then raise exception 'Cliente no encontrado' using errcode='P0002'; end if;
      if not v_cliente_activo and (p_id is null or not exists(
        select 1 from public.unidades u where u.id=p_id and u.cliente_id=v_cliente_id
      )) then raise exception 'Reactiva el cliente antes de crear o mover unidades' using errcode='55000'; end if;
      perform pg_advisory_xact_lock(hashtextextended('unidad:'||v_cliente_id::text||':'||lower(v_nombre),0));
      if exists(select 1 from public.unidades u where u.cliente_id=v_cliente_id
        and lower(btrim(u.nombre))=lower(v_nombre) and u.id is distinct from p_id) then
        raise exception 'Ya existe una unidad con ese nombre para el cliente seleccionado' using errcode='23505';
      end if;
      if p_id is null then
        insert into public.unidades(cliente_id,nombre,renovacion_defecto,activo) values(v_cliente_id,v_nombre,p_valores->>'renovacion_defecto',true)
          returning to_jsonb(unidades.*) into v_despues;
      else
        select to_jsonb(u.*) into v_antes from public.unidades u where u.id=p_id for update;
        if v_antes is null then raise exception 'Unidad no encontrada' using errcode='P0002'; end if;
        if (v_antes->>'cliente_id')::uuid<>v_cliente_id
          and exists(select 1 from public.requerimientos r where r.unidad_id=p_id) then
          raise exception 'Una unidad utilizada en requerimientos no puede cambiar de cliente' using errcode='55000';
        end if;
        update public.unidades set cliente_id=v_cliente_id,nombre=v_nombre,renovacion_defecto=p_valores->>'renovacion_defecto' where id=p_id
          returning to_jsonb(unidades.*) into v_despues;
      end if;

    when 'personal' then
      if (p_valores-'codigo_personal'-'nombre'-'dni'-'cargo')<>'{}'::jsonb then
        raise exception 'Campos de personal inválidos' using errcode='22023';
      end if;
      v_codigo:=btrim(p_valores->>'codigo_personal'); v_nombre:=btrim(p_valores->>'nombre');
      if nullif(v_codigo,'') is null or length(v_codigo)>80 or nullif(v_nombre,'') is null or length(v_nombre)>200
        or (p_valores->>'dni')!~'^[0-9]{8}$' or nullif(btrim(p_valores->>'cargo'),'') is null
        or length(btrim(p_valores->>'cargo'))>120 then
        raise exception 'Revisa código, nombre, DNI (exactamente 8 dígitos) y cargo' using errcode='22023';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('personal:'||lower(v_codigo),0));
      if exists(select 1 from public.personal p where lower(btrim(p.codigo_personal))=lower(v_codigo) and p.id is distinct from p_id) then
        raise exception 'Ya existe una persona con ese código' using errcode='23505';
      end if;
      if p_id is null then
        insert into public.personal(codigo_personal,nombre,dni,cargo,activo)
        values(v_codigo,v_nombre,p_valores->>'dni',btrim(p_valores->>'cargo'),true)
        returning to_jsonb(personal.*) into v_despues;
      else
        select to_jsonb(p.*) into v_antes from public.personal p where p.id=p_id for update;
        if v_antes is null then raise exception 'Persona no encontrada' using errcode='P0002'; end if;
        if v_codigo<>v_antes->>'codigo_personal' then raise exception 'El código de personal no puede modificarse' using errcode='55000'; end if;
        update public.personal set nombre=v_nombre,dni=p_valores->>'dni',cargo=btrim(p_valores->>'cargo')
          where id=p_id returning to_jsonb(personal.*) into v_despues;
      end if;

    when 'prendas' then
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

    when 'provincias' then
      if (p_valores-'nombre')<>'{}'::jsonb then raise exception 'Campos de provincia inválidos' using errcode='22023'; end if;
      v_nombre:=btrim(p_valores->>'nombre');
      if nullif(v_nombre,'') is null or length(v_nombre)>200 or v_nombre~'[\u0000-\u001f]' then
        raise exception 'El nombre de la provincia es obligatorio y admite hasta 200 caracteres' using errcode='22023';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('provincia:'||lower(v_nombre),0));
      if exists(select 1 from public.provincias p where lower(btrim(p.nombre))=lower(v_nombre) and p.id is distinct from p_id) then
        raise exception 'Ya existe una provincia con ese nombre' using errcode='23505';
      end if;
      if p_id is null then
        insert into public.provincias(nombre,activo) values(v_nombre,true) returning to_jsonb(provincias.*) into v_despues;
      else
        select to_jsonb(p.*) into v_antes from public.provincias p where p.id=p_id for update;
        if v_antes is null then raise exception 'Provincia no encontrada' using errcode='P0002'; end if;
        update public.provincias set nombre=v_nombre where id=p_id returning to_jsonb(provincias.*) into v_despues;
      end if;
  end case;

  insert into private.admin_catalog_audit(usuario_id,accion,catalogo,registro_id,valores_antes,valores_despues)
  values(auth.uid(),case when p_id is null then 'CREAR' else 'EDITAR' end,p_catalogo,
    (v_despues->>'id')::uuid,v_antes,v_despues);
  return jsonb_build_object('accion',case when p_id is null then 'crear' else 'editar' end,'row',v_despues);
end $$;


notify pgrst,'reload schema';
commit;
