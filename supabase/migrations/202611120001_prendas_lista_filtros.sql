-- Mantenimiento → Prendas: la lista incluye las prendas sin asignar, nuevos filtros y exportación que respeta los filtros.
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


create function public.admin_listar_prendas(
  p_busqueda text default null, p_cliente_id uuid default null, p_sin_asignar boolean default false, p_puesto_id uuid default null,
  p_genero text default null, p_renovacion text default null, p_almacen text default null, p_estado text default 'activas',
  p_limite integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable set search_path=pg_catalog,public,pg_temp as $$
declare
  v_q text:=lower(translate(btrim(coalesce(p_busqueda,'')),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun'));
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
    where (v_q='' or position(v_q in lower(translate(p.codigo_prenda||' '||p.nombre_prenda,'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')))>0)
      and (p_almacen is null or p.codigo_almacen=p_almacen)
      and (p_estado='todas' or (p_estado='activas')=p.activo)
      and (case when p_sin_asignar then not v_asig and not exists(select 1 from public.prenda_clientes a where a.prenda_id=p.id)
                when v_asig then exists(select 1 from public.prenda_clientes a where a.prenda_id=p.id
        and (p_cliente_id is null or a.cliente_id=p_cliente_id) and (p_puesto_id is null or a.puesto_id=p_puesto_id)
        and (p_genero is null or a.genero=p_genero) and (p_renovacion is null or a.renovacion=p_renovacion)) else true end);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre_prenda,x.id),'[]') into v_rows from (
    select p.id,p.codigo_prenda,p.nombre_prenda,p.codigo_almacen,p.precio,p.activo,
      not exists(select 1 from public.prenda_clientes a where a.prenda_id=p.id) sin_asignar,
      coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'cliente_id',a.cliente_id,'cliente',c.nombre,'puesto_id',a.puesto_id,'puesto',pu.nombre,
          'renovacion',a.renovacion,'genero',a.genero,'cantidad',a.cantidad,'activo',a.activo) order by c.nombre,pu.nombre nulls first,a.renovacion)
        from public.prenda_clientes a join public.clientes c on c.id=a.cliente_id
        left join public.puestos pu on pu.id=a.puesto_id where a.prenda_id=p.id),'[]'::jsonb) asignaciones
    from public.prendas p
    where (v_q='' or position(v_q in lower(translate(p.codigo_prenda||' '||p.nombre_prenda,'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')))>0)
      and (p_almacen is null or p.codigo_almacen=p_almacen)
      and (p_estado='todas' or (p_estado='activas')=p.activo)
      and (case when p_sin_asignar then not v_asig and not exists(select 1 from public.prenda_clientes a where a.prenda_id=p.id)
                when v_asig then exists(select 1 from public.prenda_clientes a where a.prenda_id=p.id
        and (p_cliente_id is null or a.cliente_id=p_cliente_id) and (p_puesto_id is null or a.puesto_id=p_puesto_id)
        and (p_genero is null or a.genero=p_genero) and (p_renovacion is null or a.renovacion=p_renovacion)) else true end)
    order by p.nombre_prenda,p.id limit p_limite offset p_offset) x;
  select coalesce(jsonb_agg(z.codigo_almacen order by z.codigo_almacen),'[]') into v_almacenes
    from (select distinct codigo_almacen from public.prendas) z;
  return jsonb_build_object('rows',v_rows,'total',v_total,'almacenes',v_almacenes);
end $$;
revoke all on function public.admin_listar_prendas(text,uuid,boolean,uuid,text,text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.admin_listar_prendas(text,uuid,boolean,uuid,text,text,text,text,integer,integer) to authenticated;


CREATE OR REPLACE FUNCTION public.admin_listar_catalogo(p_catalogo text, p_busqueda text DEFAULT NULL::text, p_cliente_id uuid DEFAULT NULL::uuid, p_genero text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v_rows jsonb; v_total integer; v_q text:=lower(btrim(coalesce(p_busqueda,'')));
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_catalogo not in ('clientes','unidades','personal','prendas','provincias','puestos','cargos') or length(v_q)>120
    or p_limite is null or p_limite<1 or p_limite>100 or p_offset is null or p_offset<0 or p_offset>50000
    or (p_genero is not null and p_genero not in ('HOMBRE','MUJER','AMBOS')) then
    raise exception 'Filtros inválidos' using errcode='22023';
  end if;
  case p_catalogo
    when 'clientes' then
      select count(*) into v_total from public.clientes c where v_q='' or position(v_q in lower(c.nombre))>0;
      select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre,x.id),'[]') into v_rows from (
        select c.id,c.nombre,c.activo,c.diferencia_puestos from public.clientes c where v_q='' or position(v_q in lower(c.nombre))>0
        order by c.nombre,c.id limit p_limite offset p_offset) x;
    when 'cargos' then
      select count(*) into v_total from public.cargos c where v_q='' or position(v_q in lower(c.nombre))>0;
      select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre,x.id),'[]') into v_rows from (
        select c.id,c.nombre,c.activo,(select count(*) from public.personal p where p.cargo=c.nombre) personas
        from public.cargos c where v_q='' or position(v_q in lower(c.nombre))>0
        order by c.nombre,c.id limit p_limite offset p_offset) x;
    when 'puestos' then
      select count(*) into v_total from public.puestos pu where (p_cliente_id is null or pu.cliente_id=p_cliente_id)
        and (v_q='' or position(v_q in lower(pu.nombre))>0);
      select coalesce(jsonb_agg((to_jsonb(x)-'cliente_orden') order by x.cliente_orden,x.nombre,x.id),'[]') into v_rows from (
        select pu.id,pu.cliente_id,pu.nombre,pu.activo,jsonb_build_object('nombre',c.nombre) clientes,lower(c.nombre) cliente_orden
        from public.puestos pu join public.clientes c on c.id=pu.cliente_id
        where (p_cliente_id is null or pu.cliente_id=p_cliente_id) and (v_q='' or position(v_q in lower(pu.nombre))>0)
        order by lower(c.nombre),pu.nombre,pu.id limit p_limite offset p_offset) x;
    when 'unidades' then
      select count(*) into v_total from public.unidades u where (p_cliente_id is null or u.cliente_id=p_cliente_id)
        and (v_q='' or position(v_q in lower(u.nombre))>0);
      select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre,x.id),'[]') into v_rows from (
        select u.id,u.cliente_id,u.nombre,u.renovacion_defecto,u.activo,jsonb_build_object('nombre',c.nombre) clientes
        from public.unidades u join public.clientes c on c.id=u.cliente_id
        where (p_cliente_id is null or u.cliente_id=p_cliente_id) and (v_q='' or position(v_q in lower(u.nombre))>0)
        order by u.nombre,u.id limit p_limite offset p_offset) x;
    when 'personal' then
      select count(*) into v_total from public.personal p where v_q='' or
        position(v_q in lower(concat_ws(' ',p.codigo_personal,p.nombre,p.dni,p.cargo)))>0;
      select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre,x.id),'[]') into v_rows from (
        select p.id,p.codigo_personal,p.nombre,p.dni,p.cargo,p.activo from public.personal p where v_q='' or
          position(v_q in lower(concat_ws(' ',p.codigo_personal,p.nombre,p.dni,p.cargo)))>0
        order by p.nombre,p.id limit p_limite offset p_offset) x;
    when 'prendas' then
      return public.admin_listar_prendas(p_busqueda,p_cliente_id,false,null,p_genero,null,null,'todas',p_limite,p_offset);
    when 'provincias' then
      select count(*) into v_total from public.provincias p where v_q='' or position(v_q in lower(p.nombre))>0;
      select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre,x.id),'[]') into v_rows from (
        select p.id,p.nombre,p.activo from public.provincias p where v_q='' or position(v_q in lower(p.nombre))>0
        order by p.nombre,p.id limit p_limite offset p_offset) x;
  end case;
  return jsonb_build_object('rows',v_rows,'total',v_total);
end $function$;

CREATE OR REPLACE FUNCTION private.admin_guardar_catalogo(p_catalogo text, p_id uuid, p_valores jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_antes jsonb; v_despues jsonb; v_nombre text; v_codigo text;
  v_cargo_n text; v_usa boolean; v_puesto_id uuid; v_cliente_id uuid; v_cliente_nombre text; v_cliente_activo boolean; v_prenda_id uuid; v_a jsonb; v_alcance text; v_impacto jsonb; v_precio numeric; v_almacen text;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_catalogo not in ('clientes','unidades','personal','prendas','provincias','puestos','cargos') or p_valores is null
    or jsonb_typeof(p_valores)<>'object' then raise exception 'Datos inválidos' using errcode='22023'; end if;

  case p_catalogo
    when 'clientes' then
      if (p_valores-'nombre'-'diferencia_puestos')<>'{}'::jsonb
        or (p_valores ? 'diferencia_puestos' and jsonb_typeof(p_valores->'diferencia_puestos')<>'boolean') then
        raise exception 'Campos de cliente inválidos' using errcode='22023'; end if;
      v_usa:=case when p_valores ? 'diferencia_puestos' then (p_valores->>'diferencia_puestos')::boolean end;
      v_nombre:=btrim(p_valores->>'nombre');
      if nullif(v_nombre,'') is null or length(v_nombre)>200 or v_nombre~'[\u0000-\u001f]' then
        raise exception 'El nombre del cliente es obligatorio y admite hasta 200 caracteres' using errcode='22023';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('cliente:'||lower(v_nombre),0));
      if exists(select 1 from public.clientes c where lower(btrim(c.nombre))=lower(v_nombre) and c.id is distinct from p_id) then
        raise exception 'Ya existe un cliente con ese nombre' using errcode='23505';
      end if;
      if p_id is null then
        insert into public.clientes(nombre,activo,diferencia_puestos) values(v_nombre,true,coalesce(v_usa,false)) returning to_jsonb(clientes.*) into v_despues;
      else
        select to_jsonb(c.*) into v_antes from public.clientes c where c.id=p_id for update;
        if v_antes is null then raise exception 'Cliente no encontrado' using errcode='P0002'; end if;
        update public.clientes set nombre=v_nombre,diferencia_puestos=coalesce(v_usa,diferencia_puestos) where id=p_id returning to_jsonb(clientes.*) into v_despues;
      end if;

    when 'cargos' then
      if (p_valores-'nombre')<>'{}'::jsonb then raise exception 'Campos de cargo inválidos' using errcode='22023'; end if;
      v_nombre:=btrim(p_valores->>'nombre');
      if nullif(v_nombre,'') is null or length(v_nombre)>120 or v_nombre~'[\u0000-\u001f]' then
        raise exception 'El nombre del cargo es obligatorio y admite hasta 120 caracteres' using errcode='22023';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('cargo:'||lower(v_nombre),0));
      if exists(select 1 from public.cargos c where lower(c.nombre)=lower(v_nombre) and c.id is distinct from p_id) then
        raise exception 'Ya existe un cargo con ese nombre' using errcode='23505';
      end if;
      if p_id is null then
        insert into public.cargos(nombre,activo,origen) values(v_nombre,true,'manual') returning to_jsonb(cargos.*) into v_despues;
      else
        select to_jsonb(c.*) into v_antes from public.cargos c where c.id=p_id for update;
        if v_antes is null then raise exception 'Cargo no encontrado' using errcode='P0002'; end if;
        -- Renombrar actualiza la ficha de las personas (ON UPDATE CASCADE); los requerimientos conservan su copia.
        update public.cargos set nombre=v_nombre,updated_at=now() where id=p_id returning to_jsonb(cargos.*) into v_despues;
      end if;

    when 'puestos' then
      if (p_valores-'nombre'-'cliente_id')<>'{}'::jsonb then raise exception 'Campos de puesto inválidos' using errcode='22023'; end if;
      v_nombre:=btrim(p_valores->>'nombre');
      begin v_cliente_id:=(p_valores->>'cliente_id')::uuid;
      exception when invalid_text_representation then raise exception 'Selecciona un cliente válido' using errcode='22023'; end;
      if nullif(v_nombre,'') is null or length(v_nombre)>200 or v_nombre~'[\u0000-\u001f]' then
        raise exception 'El nombre del puesto es obligatorio y admite hasta 200 caracteres' using errcode='22023';
      end if;
      select c.nombre,c.activo,c.diferencia_puestos into v_cliente_nombre,v_cliente_activo,v_usa from public.clientes c where c.id=v_cliente_id for share;
      if not found then raise exception 'Cliente no encontrado' using errcode='P0002'; end if;
      if not v_usa then raise exception 'Este cliente no diferencia prendas por puesto: actívalo en Clientes primero' using errcode='22023'; end if;
      perform pg_advisory_xact_lock(hashtextextended('puesto:'||v_cliente_id::text||':'||lower(v_nombre),0));
      if exists(select 1 from public.puestos pu where pu.cliente_id=v_cliente_id and lower(pu.nombre)=lower(v_nombre) and pu.id is distinct from p_id) then
        raise exception 'Ya existe un puesto con ese nombre para el cliente' using errcode='23505';
      end if;
      if p_id is null then
        if not v_cliente_activo then raise exception 'Reactiva el cliente antes de crear puestos' using errcode='55000'; end if;
        insert into public.puestos(cliente_id,nombre,activo) values(v_cliente_id,v_nombre,true) returning to_jsonb(puestos.*) into v_despues;
      else
        select to_jsonb(pu.*) into v_antes from public.puestos pu where pu.id=p_id for update;
        if v_antes is null then raise exception 'Puesto no encontrado' using errcode='P0002'; end if;
        if (v_antes->>'cliente_id')::uuid<>v_cliente_id then raise exception 'Un puesto no puede cambiar de cliente' using errcode='55000'; end if;
        update public.puestos set nombre=v_nombre where id=p_id returning to_jsonb(puestos.*) into v_despues;
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
      -- El cargo debe existir en el catálogo y estar activo (o ser el que la persona ya tiene).
      select c.nombre into v_cargo_n from public.cargos c where lower(c.nombre)=lower(btrim(p_valores->>'cargo'))
        and (c.activo or c.nombre=(select p.cargo from public.personal p where p.id=p_id));
      if not found then raise exception 'El cargo no existe en el catálogo de cargos o está inactivo' using errcode='22023'; end if;
      perform pg_advisory_xact_lock(hashtextextended('personal:'||lower(v_codigo),0));
      if exists(select 1 from public.personal p where lower(btrim(p.codigo_personal))=lower(v_codigo) and p.id is distinct from p_id) then
        raise exception 'Ya existe una persona con ese código' using errcode='23505';
      end if;
      if p_id is null then
        insert into public.personal(codigo_personal,nombre,dni,cargo,activo)
        values(v_codigo,v_nombre,p_valores->>'dni',v_cargo_n,true)
        returning to_jsonb(personal.*) into v_despues;
      else
        select to_jsonb(p.*) into v_antes from public.personal p where p.id=p_id for update;
        if v_antes is null then raise exception 'Persona no encontrada' using errcode='P0002'; end if;
        if v_codigo<>v_antes->>'codigo_personal' then raise exception 'El código de personal no puede modificarse' using errcode='55000'; end if;
        update public.personal set nombre=v_nombre,dni=p_valores->>'dni',cargo=v_cargo_n
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
      select p.id into v_prenda_id from public.prendas p where lower(btrim(p.codigo_prenda))=lower(v_codigo) and p.id is distinct from p_id limit 1;
      if found then
        raise exception 'Ya existe una prenda con ese código' using errcode='23505',detail=v_prenda_id::text,hint='prenda_existente';
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
        if jsonb_typeof(v_a)<>'object' or (v_a-'id'-'cliente_id'-'puesto_id'-'renovacion'-'genero'-'cantidad'-'activo')<>'{}'::jsonb
          or v_a->>'renovacion' is null or v_a->>'renovacion' not in ('VERANO','INVIERNO','AMBOS')
          or v_a->>'genero' is null or v_a->>'genero' not in ('HOMBRE','MUJER','AMBOS')
          or (v_a->>'cantidad')!~'^[1-9][0-9]{0,4}$' or (v_a->>'cantidad')::integer>10000
          or jsonb_typeof(v_a->'activo')<>'boolean'
          or (v_a ? 'puesto_id' and jsonb_typeof(v_a->'puesto_id') not in ('null','string')) then
          raise exception 'Revisa las asignaciones: cliente, puesto, renovación, género, cantidad y estado' using errcode='22023';
        end if;
        begin v_puesto_id:=nullif(v_a->>'puesto_id','')::uuid;
        exception when invalid_text_representation then raise exception 'Selecciona un puesto válido' using errcode='22023'; end;
        begin
          if v_a->>'id' is not null then
            update public.prenda_clientes set renovacion=v_a->>'renovacion',genero=v_a->>'genero',cantidad=(v_a->>'cantidad')::integer,activo=(v_a->>'activo')::boolean
              where id=(v_a->>'id')::uuid and prenda_id=v_prenda_id
                and (v_a->>'cliente_id' is null or cliente_id=(v_a->>'cliente_id')::uuid)
                and puesto_id is not distinct from v_puesto_id;
            if not found then raise exception 'Asignación no encontrada' using errcode='P0002'; end if;
          else
            begin v_cliente_id:=(v_a->>'cliente_id')::uuid;
            exception when invalid_text_representation then raise exception 'Selecciona un cliente válido' using errcode='22023'; end;
            select c.nombre,c.activo into v_cliente_nombre,v_cliente_activo from public.clientes c where c.id=v_cliente_id for share;
            if not found then raise exception 'Cliente no encontrado' using errcode='P0002'; end if;
            if not v_cliente_activo and (v_a->>'activo')::boolean then raise exception 'Selecciona un cliente activo' using errcode='55000'; end if;
            insert into public.prenda_clientes(prenda_id,cliente_id,puesto_id,renovacion,genero,cantidad,activo)
              values(v_prenda_id,v_cliente_id,v_puesto_id,v_a->>'renovacion',v_a->>'genero',(v_a->>'cantidad')::integer,(v_a->>'activo')::boolean);
          end if;
        exception when unique_violation then
          raise exception 'Esa prenda ya tiene una asignación para el mismo cliente, puesto y renovación' using errcode='23505';
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
end $function$;

drop function public.admin_exportar_prendas(uuid);

create function public.admin_exportar_prendas(
  p_cliente_id uuid default null, p_busqueda text default null, p_sin_asignar boolean default false, p_puesto_id uuid default null,
  p_genero text default null, p_renovacion text default null, p_almacen text default null, p_estado text default 'todas') returns jsonb
language plpgsql stable set search_path=pg_catalog,public,pg_temp as $$
declare
  v_q text:=lower(translate(btrim(coalesce(p_busqueda,'')),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun'));
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
      and (v_q='' or position(v_q in lower(translate(p.codigo_prenda||' '||p.nombre_prenda,'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')))>0) and (p_almacen is null or p.codigo_almacen=p_almacen)
      and (p_estado='todas' or (p_estado='activas')=p.activo)
      and (p_cliente_id is null or a.cliente_id=p_cliente_id) and (p_puesto_id is null or a.puesto_id=p_puesto_id)
      and (p_genero is null or a.genero=p_genero) and (p_renovacion is null or a.renovacion=p_renovacion)
    union all
    select jsonb_build_object('codigo_prenda',p.codigo_prenda,'nombre_prenda',p.nombre_prenda,'codigo_almacen',p.codigo_almacen,
        'precio',to_char(p.precio,'FM9999999990.00'),'cantidad',null,'cliente',null,'puesto',null,'genero',null,'renovacion',null,'activo',p.activo),
      lower(p.codigo_prenda),'','','',p.id::text
    from public.prendas p
    where not v_asig and not exists(select 1 from public.prenda_clientes a where a.prenda_id=p.id)
      and (v_q='' or position(v_q in lower(translate(p.codigo_prenda||' '||p.nombre_prenda,'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')))>0) and (p_almacen is null or p.codigo_almacen=p_almacen)
      and (p_estado='todas' or (p_estado='activas')=p.activo)
  ) x),'[]'::jsonb);
end $$;
revoke all on function public.admin_exportar_prendas(uuid,text,boolean,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_exportar_prendas(uuid,text,boolean,uuid,text,text,text,text) to authenticated;

notify pgrst,'reload schema';
commit;
