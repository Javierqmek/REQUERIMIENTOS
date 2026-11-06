-- Editar renovación y cargo en requerimientos ya creados + catálogo de cargos.
-- Aplicar después de 202611050001. UNA sola ejecución (todo en una transacción).
--
-- 1. public.cargos (nombre, activo). Carga inicial: AGENTE DIA, AGENTE NOCHE, DESCANSERO, SUPERVISOR y TODOS los valores distintos
--    que hay hoy en personal.cargo (origen='existente'; si un mismo cargo viene escrito con distinta capitalización se unifica
--    con la forma más usada). personal.cargo pasa a referenciar cargos(nombre) (ON UPDATE CASCADE: renombrar un cargo lo
--    actualiza en la ficha de las personas; los requerimientos guardan su propia copia y no cambian).
-- 2. requerimientos.cargo: copia del cargo con el que se pidió (se rellena con el cargo actual del trabajador).
--    Se llena sola al crear; solo cambia con editar_cabecera_requerimiento.
-- 3. editar_cabecera_requerimiento: cambia SOLO la renovación (con la referencia interna RENOVACION ...) y/o el cargo en
--    requerimientos Pendiente u Observado. Si hay prendas que no corresponden a la nueva renovación devuelve la lista y exige
--    confirmarla; al confirmar esas líneas se desactivan (no se borran). Todo queda en requerimiento_cambios.
-- 4. crear_requerimiento recibe el cargo (p_cargo, opcional); importar personal y Mantenimiento → Personal validan contra el catálogo.
begin;

-- ===== 1. catálogo de cargos =====
create table public.cargos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activo boolean not null default true,
  origen text not null default 'manual' check (origen in ('inicial','existente','manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cargos_nombre_valido check (nombre=btrim(nombre) and char_length(nombre) between 1 and 120 and nombre !~ '[\u0000-\u001f]'),
  constraint cargos_nombre_uk unique (nombre)
);
create unique index cargos_nombre_ci_uidx on public.cargos(lower(nombre));
alter table public.cargos enable row level security;
create policy cargos_lectura on public.cargos for select to authenticated using (activo or (select public.is_admin()));
revoke all on public.cargos from public,anon,authenticated;
grant select on public.cargos to authenticated;
grant select,insert,update,delete on public.cargos to service_role;

-- Valores que existen hoy: se limpian espacios y se unifica la capitalización con la forma más usada.
update public.personal set cargo='AGENTE' where btrim(cargo)='';
update public.personal set cargo=btrim(cargo) where cargo<>btrim(cargo);
insert into public.cargos(nombre,origen)
  select distinct on (lower(cargo)) cargo,'existente' from (
    select cargo,count(*) n from public.personal group by cargo) t
  order by lower(cargo),n desc,cargo;
update public.personal p set cargo=c.nombre from public.cargos c where lower(c.nombre)=lower(p.cargo) and p.cargo<>c.nombre;
insert into public.cargos(nombre,origen)
  select v,'inicial' from (values ('AGENTE DIA'),('AGENTE NOCHE'),('DESCANSERO'),('SUPERVISOR')) d(v)
  where not exists(select 1 from public.cargos c where lower(c.nombre)=lower(d.v));
do $$ declare v text; begin
  select string_agg(nombre||' ('||(select count(*) from public.personal p where p.cargo=c.nombre)||')',', ' order by nombre) into v
    from public.cargos c where origen='existente';
  raise notice 'Cargos que existían en personal.cargo: %',coalesce(v,'(ninguno)');
end $$;

alter table public.personal add constraint personal_cargo_fkey foreign key (cargo) references public.cargos(nombre) on update cascade on delete restrict deferrable initially deferred;

alter table private.admin_catalog_audit drop constraint admin_catalog_audit_catalogo_check;
alter table private.admin_catalog_audit add constraint admin_catalog_audit_catalogo_check
  check (catalogo in ('clientes','unidades','personal','prendas','provincias','puestos','cargos'));

-- ===== 2. copia del cargo en el requerimiento + historial de cambios =====
alter table public.requerimientos add column cargo text;
-- La relleno con la bandera de edición de cabecera (el trigger de protección aún no conoce la columna).
select set_config('app.edicion_cabecera','on',true);
update public.requerimientos r set cargo=p.cargo from public.personal p where p.id=r.agente_id;
select set_config('app.edicion_cabecera','off',true);

create table public.requerimiento_cambios (
  id uuid primary key default gen_random_uuid(),
  requerimiento_id uuid not null references public.requerimientos(id) on delete cascade,
  usuario_id uuid not null,
  created_at timestamptz not null default now(),
  renovacion_antes text, renovacion_despues text,
  referencia_antes text, referencia_despues text,
  cargo_antes text, cargo_despues text,
  cargo_ficha_antes text,
  lineas_quitadas jsonb not null default '[]'::jsonb
);
create index requerimiento_cambios_req_idx on public.requerimiento_cambios(requerimiento_id,created_at);
alter table public.requerimiento_cambios enable row level security;
create policy requerimiento_cambios_lectura on public.requerimiento_cambios for select to authenticated
  using ((select public.is_admin()) or exists(select 1 from public.requerimientos r where r.id=requerimiento_id and r.usuario_creador_id=auth.uid()));
revoke all on public.requerimiento_cambios from public,anon,authenticated;
grant select on public.requerimiento_cambios to authenticated;
grant select,insert,update,delete on public.requerimiento_cambios to service_role;


CREATE OR REPLACE FUNCTION public.proteger_requerimiento_actualizado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
  if new.id is distinct from old.id or new.fecha is distinct from old.fecha
    or new.agente_id is distinct from old.agente_id
    or (new.cargo is distinct from old.cargo and pg_catalog.current_setting('app.edicion_cabecera',true) is distinct from 'on')
    or new.usuario_creador_id is distinct from old.usuario_creador_id
    or new.cliente_id is distinct from old.cliente_id
    or new.unidad_id is distinct from old.unidad_id
    or new.puesto_id is distinct from old.puesto_id
    or (new.referencia_interna is distinct from old.referencia_interna and pg_catalog.current_setting('app.edicion_cabecera',true) is distinct from 'on')
    or new.created_at is distinct from old.created_at then
    raise exception 'Solo se permite cambiar el estado';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.validar_destino_requerimiento()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v_usa boolean;
begin
  if new.cliente_id is null or new.unidad_id is null then
    raise exception 'Selecciona un cliente y una unidad';
  end if;
  select c.diferencia_puestos into v_usa from public.clientes c join public.unidades u
      on u.cliente_id=c.id where c.id=new.cliente_id and u.id=new.unidad_id and c.activo and u.activo;
  if not found then
    raise exception 'Cliente o unidad inválidos o inactivos';
  end if;
  if v_usa and new.puesto_id is null then
    raise exception 'Selecciona el puesto' using errcode='22023';
  end if;
  if not v_usa and new.puesto_id is not null then
    raise exception 'El cliente no diferencia prendas por puesto' using errcode='22023';
  end if;
  if new.puesto_id is not null and not exists(select 1 from public.puestos pu where pu.id=new.puesto_id and pu.cliente_id=new.cliente_id and pu.activo) then
    raise exception 'Puesto inválido o inactivo' using errcode='22023';
  end if;
  -- Copia del cargo con el que se pide (si no viene, el actual de la ficha).
  if new.cargo is null then
    select p.cargo into new.cargo from public.personal p where p.id=new.agente_id;
  end if;
  return new;
end;
$function$;

drop function public.crear_requerimiento(uuid,uuid,uuid,text,jsonb,uuid,text,uuid);

CREATE OR REPLACE FUNCTION public.crear_requerimiento(p_agente_id uuid, p_cliente_id uuid, p_unidad_id uuid, p_renovacion text, p_detalles jsonb, p_request_id uuid, p_genero text, p_puesto_id uuid DEFAULT NULL::uuid, p_cargo text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_id uuid;
  v_cliente text;
  v_usa boolean;
  v_ficha text;
  v_cargo text;
  v_prendas uuid[];
  v_count integer;
begin
  if auth.uid() is null or p_request_id is null or not exists(
    select 1 from public.profiles where id=auth.uid() and role in ('admin','superadmin','coordinador')) then
    raise exception 'Solicitud no autorizada o incompleta' using errcode='42501';
  end if;
  if p_renovacion is null or p_renovacion not in ('VERANO','INVIERNO') then
    raise exception 'Selecciona el tipo de renovación (Verano o Invierno)' using errcode='22023';
  end if;
  if p_genero is null or p_genero not in ('HOMBRE','MUJER') then
    raise exception 'Selecciona el género de las prendas (Hombre o Mujer)' using errcode='22023';
  end if;
  -- Serializa únicamente reintentos de la misma solicitud del mismo usuario.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text || ':' || p_request_id::text,0));
  select r.id into v_id from public.requerimientos r
    where r.usuario_creador_id=auth.uid() and r.request_id=p_request_id;
  if found then return v_id; end if;
  select p.cargo into v_ficha from public.personal p where p.id=p_agente_id and p.activo for update;
  if not found then raise exception 'Agente inválido o inactivo'; end if;
  v_cargo:=v_ficha;
  -- Cargo elegido en el formulario: debe existir y estar activo; si cambia, se actualiza también la ficha del trabajador.
  if p_cargo is not null and lower(btrim(p_cargo)) is distinct from lower(v_ficha) then
    select c.nombre into v_cargo from public.cargos c where lower(c.nombre)=lower(btrim(p_cargo)) and c.activo;
    if not found then raise exception 'El cargo no existe en el catálogo o está inactivo' using errcode='22023'; end if;
    update public.personal set cargo=v_cargo where id=p_agente_id;
    insert into private.admin_catalog_audit(usuario_id,accion,catalogo,registro_id,valores_antes,valores_despues)
      values(auth.uid(),'EDITAR','personal',p_agente_id,jsonb_build_object('cargo',v_ficha),jsonb_build_object('cargo',v_cargo,'origen','crear_requerimiento'));
  end if;
  select nombre,diferencia_puestos into v_cliente,v_usa from public.clientes where id=p_cliente_id and activo for share;
  if not found then raise exception 'Selecciona un cliente activo'; end if;
  if v_usa and p_puesto_id is null then raise exception 'Selecciona el puesto' using errcode='22023'; end if;
  if not v_usa and p_puesto_id is not null then raise exception 'El cliente no diferencia prendas por puesto' using errcode='22023'; end if;
  if p_puesto_id is not null then
    perform 1 from public.puestos pu where pu.id=p_puesto_id and pu.cliente_id=p_cliente_id and pu.activo for share;
    if not found then raise exception 'Selecciona un puesto activo del cliente' using errcode='22023'; end if;
  end if;
  perform id from public.unidades where id=p_unidad_id and cliente_id=p_cliente_id and activo for share;
  if not found then raise exception 'Selecciona una unidad activa del cliente'; end if;
  if p_detalles is null or jsonb_typeof(p_detalles)<>'array' then raise exception 'Debe incluir prendas'; end if;
  if jsonb_array_length(p_detalles)=0 then raise exception 'Debe incluir prendas'; end if;
  if jsonb_array_length(p_detalles)>500 or octet_length(p_detalles::text)>131072 then
    raise exception 'Demasiadas prendas' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_detalles) x
    where jsonb_typeof(x)<>'object' or not (x ? 'prenda_id') or (x - 'prenda_id')<>'{}'::jsonb) then
    raise exception 'Solo se aceptan identificadores de prendas' using errcode='22023';
  end if;
  select array_agg(x.prenda_id),count(distinct x.prenda_id)
    into v_prendas,v_count from jsonb_to_recordset(p_detalles) as x(prenda_id uuid);
  -- Cada prenda solo una vez por requerimiento: si hace falta más, se sube la cantidad.
  if v_count<>jsonb_array_length(p_detalles) then
    raise exception 'Detalles inválidos o duplicados' using errcode='22023';
  end if;
  -- Cada prenda debe estar asignada (activa) a ESTE cliente y a esta renovación (o AMBOS). Se mantiene
  -- estable la ficha y la asignación mientras se copian cantidad/precio/código.
  perform 1 from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id
    where a.prenda_id=any(v_prendas) and a.cliente_id=p_cliente_id and a.activo and p.activo
      and a.puesto_id is not distinct from p_puesto_id
      and a.renovacion in (p_renovacion,'AMBOS') and a.genero in (p_genero,'AMBOS')
    order by a.id for share of a,p;
  get diagnostics v_count=row_count;
  if v_count<>cardinality(v_prendas) then
    raise exception 'La prenda no corresponde al cliente, el puesto, la renovación ni el género seleccionados, o está inactiva' using errcode='22023';
  end if;
  insert into public.requerimientos(agente_id,usuario_creador_id,cliente_id,unidad_id,puesto_id,renovacion,referencia_interna,request_id,cargo)
    values(p_agente_id,auth.uid(),p_cliente_id,p_unidad_id,p_puesto_id,p_renovacion,'RENOVACION '||p_renovacion,p_request_id,v_cargo) returning id into v_id;
  insert into public.detalle_requerimiento(requerimiento_id,prenda_id,cantidad,precio_unitario,codigo_almacen)
    select v_id,p.id,a.cantidad,p.precio,p.codigo_almacen from public.prendas p
    join public.prenda_clientes a on a.prenda_id=p.id and a.cliente_id=p_cliente_id and a.activo
      and a.puesto_id is not distinct from p_puesto_id
      and a.renovacion in (p_renovacion,'AMBOS') and a.genero in (p_genero,'AMBOS')
    where p.id=any(v_prendas);
  return v_id;
end;
$function$;

revoke all on function public.crear_requerimiento(uuid,uuid,uuid,text,jsonb,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.crear_requerimiento(uuid,uuid,uuid,text,jsonb,uuid,text,uuid,text) to authenticated;


CREATE OR REPLACE FUNCTION public.listar_requerimientos_filtrados(p_cliente_id uuid DEFAULT NULL::uuid, p_unidad_id uuid DEFAULT NULL::uuid, p_estado estado_requerimiento DEFAULT NULL::estado_requerimiento, p_genero text DEFAULT NULL::text, p_prendas_min integer DEFAULT NULL::integer, p_prendas_max integer DEFAULT NULL::integer, p_unidades_min integer DEFAULT NULL::integer, p_unidades_max integer DEFAULT NULL::integer, p_busqueda text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0, p_renovacion text DEFAULT NULL::text, p_puesto_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_genero is not null and p_genero not in ('HOMBRE','MUJER','AMBOS') then raise exception 'Género inválido' using errcode='22023'; end if;
  if p_renovacion is not null and p_renovacion not in ('VERANO','INVIERNO') then raise exception 'Renovación inválida' using errcode='22023'; end if;
  if length(p_busqueda)>120 or p_limite is null or p_limite<1 or p_limite>100 or p_offset is null or p_offset<0 or p_offset>500000 then
    raise exception 'Paginación inválida' using errcode='22023';
  end if;
  if coalesce(p_prendas_min,0)<0 or coalesce(p_prendas_max,0)<0 or coalesce(p_unidades_min,0)<0 or coalesce(p_unidades_max,0)<0
    or p_prendas_min>5000 or p_prendas_max>5000 or p_unidades_min>5000 or p_unidades_max>5000
    or (p_prendas_min is not null and p_prendas_max is not null and p_prendas_min>p_prendas_max)
    or (p_unidades_min is not null and p_unidades_max is not null and p_unidades_min>p_unidades_max) then
    raise exception 'Rango inválido' using errcode='22023';
  end if;
  with rows as materialized (
    select r.id,r.fecha,r.referencia_interna,r.estado,r.renovacion,r.usuario_creador_id,r.cliente_id,r.unidad_id,r.puesto_id,r.cargo,
      case when p.id is not null then jsonb_build_object('nombre',p.nombre,'dni',p.dni,'cargo',p.cargo) end personal,
      case when c.id is not null then jsonb_build_object('nombre',c.nombre) end clientes,
      case when u.id is not null then jsonb_build_object('nombre',u.nombre) end unidades,
      case when pu.id is not null then jsonb_build_object('nombre',pu.nombre) end puestos,
      coalesce(d.cantidad_prendas,0) cantidad_prendas,coalesce(d.unidades_totales,0) unidades_totales,
      coalesce(d.total_requerimiento,0) total_requerimiento,coalesce(d.generos,'{}'::text[]) generos
    from public.requerimientos r
    left join public.personal p on p.id=r.agente_id left join public.clientes c on c.id=r.cliente_id
    left join public.unidades u on u.id=r.unidad_id left join public.puestos pu on pu.id=r.puesto_id
    left join lateral (
      select count(*)::integer cantidad_prendas,coalesce(sum(dr.cantidad),0)::integer unidades_totales,
        coalesce(sum(dr.cantidad*dr.precio_unitario),0)::numeric total_requerimiento,
        coalesce(array_agg(distinct g.genero) filter(where g.genero is not null),'{}'::text[]) generos
      from public.detalle_requerimiento dr left join lateral (select a.genero from public.prenda_clientes a where a.prenda_id=dr.prenda_id and a.cliente_id=r.cliente_id and a.puesto_id is not distinct from r.puesto_id and a.renovacion in (r.renovacion,'AMBOS') order by a.activo desc,a.updated_at desc limit 1) g on true
      where dr.requerimiento_id=r.id and dr.activo
    ) d on true where r.usuario_creador_id=auth.uid()
  ), filtered as (
    select * from rows x where (p_cliente_id is null or x.cliente_id=p_cliente_id)
      and (p_unidad_id is null or x.unidad_id=p_unidad_id) and (p_estado is null or x.estado=p_estado)
      and (p_renovacion is null or x.renovacion=p_renovacion) and (p_puesto_id is null or x.puesto_id=p_puesto_id)
      and (p_prendas_min is null or x.cantidad_prendas>=p_prendas_min) and (p_prendas_max is null or x.cantidad_prendas<=p_prendas_max)
      and (p_unidades_min is null or x.unidades_totales>=p_unidades_min) and (p_unidades_max is null or x.unidades_totales<=p_unidades_max)
      and (p_genero is null or (p_genero='HOMBRE' and x.generos&&array['HOMBRE','AMBOS'])
        or (p_genero='MUJER' and x.generos&&array['MUJER','AMBOS']) or (p_genero='AMBOS' and 'AMBOS'=any(x.generos)))
      and (nullif(trim(p_busqueda),'') is null or position(lower(trim(p_busqueda)) in lower(concat_ws(' ',x.personal->>'nombre',x.personal->>'dni',x.clientes->>'nombre',x.unidades->>'nombre',x.puestos->>'nombre',x.referencia_interna,x.id::text)))>0)
  )
  select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(x) order by x.fecha desc,x.id desc)
    from (select * from filtered order by fecha desc,id desc limit p_limite offset p_offset) x),'[]'::jsonb)) into v_result;
  return v_result;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_consultar_requerimientos_v2(p_cliente_id uuid DEFAULT NULL::uuid, p_unidad_id uuid DEFAULT NULL::uuid, p_coordinador_id uuid DEFAULT NULL::uuid, p_estado estado_requerimiento DEFAULT NULL::estado_requerimiento, p_desde timestamp with time zone DEFAULT NULL::timestamp with time zone, p_hasta timestamp with time zone DEFAULT NULL::timestamp with time zone, p_busqueda text DEFAULT NULL::text, p_genero text DEFAULT NULL::text, p_unidades_min integer DEFAULT NULL::integer, p_unidades_max integer DEFAULT NULL::integer, p_solo_duplicados boolean DEFAULT false, p_orden text DEFAULT 'fecha'::text, p_direccion text DEFAULT 'desc'::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0, p_exportar boolean DEFAULT false, p_cursor_fecha timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_creado_hasta timestamp with time zone DEFAULT NULL::timestamp with time zone, p_renovacion text DEFAULT NULL::text, p_puesto_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_orden not in ('fecha','agente','cliente','unidad','coordinador','estado','prendas','total') or p_direccion not in ('asc','desc') then raise exception 'Orden inválido' using errcode='22023'; end if;
  if p_genero is not null and p_genero not in ('HOMBRE','MUJER','AMBOS') then raise exception 'Género inválido' using errcode='22023'; end if;
  if p_renovacion is not null and p_renovacion not in ('VERANO','INVIERNO') then raise exception 'Renovación inválida' using errcode='22023'; end if;
  if length(p_busqueda)>120 or p_limite is null or p_limite<1 or p_limite>250 or p_offset is null or p_offset<0 or p_offset>49999950 then raise exception 'Paginación inválida' using errcode='22023'; end if;
  if coalesce(p_unidades_min,0)<0 or coalesce(p_unidades_max,0)<0 or p_unidades_min>5000 or p_unidades_max>5000
    or (p_unidades_min is not null and p_unidades_max is not null and p_unidades_min>p_unidades_max) then raise exception 'Rango de unidades inválido' using errcode='22023'; end if;
  if (p_cursor_fecha is null)<>(p_cursor_id is null) then raise exception 'Cursor incompleto' using errcode='22023'; end if;
  if p_desde is not null and p_hasta is not null and p_desde>=p_hasta then raise exception 'Rango inválido' using errcode='22023'; end if;
  with all_rows as materialized (
    select r.id,r.fecha,r.created_at,r.referencia_interna,r.estado,r.renovacion,r.agente_id,r.cliente_id,r.unidad_id,r.puesto_id,r.cargo,r.usuario_creador_id,
      jsonb_build_object('nombre',p.nombre,'dni',p.dni,'cargo',p.cargo) personal,
      case when c.id is not null then jsonb_build_object('nombre',c.nombre) end clientes,
      case when u.id is not null then jsonb_build_object('nombre',u.nombre) end unidades,
      case when pu.id is not null then jsonb_build_object('nombre',pu.nombre) end puestos,
      jsonb_build_object('nombre',pr.nombre,'email',pr.email) profiles,
      lower(coalesce(p.nombre,'')) agente_orden,lower(coalesce(c.nombre,'')) cliente_orden,
      lower(coalesce(u.nombre,'')) unidad_orden,lower(coalesce(pr.nombre,pr.email,'')) coordinador_orden,
      coalesce(d.cantidad_prendas,0) cantidad_prendas,coalesce(d.unidades_totales,0) unidades_totales,
      coalesce(d.total_requerimiento,0) total_requerimiento,coalesce(d.generos,'{}'::text[]) generos
    from public.requerimientos r left join public.personal p on p.id=r.agente_id
    left join public.clientes c on c.id=r.cliente_id left join public.unidades u on u.id=r.unidad_id
    left join public.puestos pu on pu.id=r.puesto_id
    left join public.profiles pr on pr.id=r.usuario_creador_id
    left join lateral (
      select count(*)::integer cantidad_prendas,coalesce(sum(dr.cantidad),0)::integer unidades_totales,
        coalesce(sum(dr.cantidad*dr.precio_unitario),0)::numeric total_requerimiento,
        coalesce(array_agg(distinct g.genero) filter(where g.genero is not null),'{}'::text[]) generos
      from public.detalle_requerimiento dr left join lateral (select a.genero from public.prenda_clientes a where a.prenda_id=dr.prenda_id and a.cliente_id=r.cliente_id and a.puesto_id is not distinct from r.puesto_id and a.renovacion in (r.renovacion,'AMBOS') order by a.activo desc,a.updated_at desc limit 1) g on true
      where dr.requerimiento_id=r.id and dr.activo
    ) d on true
  ), annotated as (
    select a.*,m.grupo_duplicado_id,m.coincidencias+1 grupo_duplicado_tamano,m.coincidencias>0 posible_duplicado,
      m.coincidencias>0 and a.cantidad_prendas<m.max_prendas potencialmente_incompleto
    from all_rows a left join lateral (
      select least(a.id::text,min(b.id::text))::uuid grupo_duplicado_id,count(*)::integer coincidencias,
        greatest(a.cantidad_prendas,max(b.cantidad_prendas))::integer max_prendas
      from all_rows b where b.id<>a.id and b.agente_id=a.agente_id and b.cliente_id is not distinct from a.cliente_id
        and b.unidad_id is not distinct from a.unidad_id and b.usuario_creador_id=a.usuario_creador_id
        and abs(extract(epoch from (b.created_at-a.created_at)))<=86400
        and (b.estado=a.estado or (b.estado in ('Pendiente','Observado') and a.estado in ('Pendiente','Observado')))
    ) m on true
  ), scoped as (
    select * from annotated a where (p_cliente_id is null or a.cliente_id=p_cliente_id)
      and (p_unidad_id is null or a.unidad_id=p_unidad_id) and (p_coordinador_id is null or a.usuario_creador_id=p_coordinador_id)
      and (p_estado is null or a.estado=p_estado) and (p_renovacion is null or a.renovacion=p_renovacion) and (p_puesto_id is null or a.puesto_id=p_puesto_id) and (p_desde is null or a.fecha>=p_desde) and (p_hasta is null or a.fecha<p_hasta)
      and (p_creado_hasta is null or a.created_at<=p_creado_hasta)
      and (p_unidades_min is null or a.unidades_totales>=p_unidades_min) and (p_unidades_max is null or a.unidades_totales<=p_unidades_max)
      and (p_genero is null or (p_genero='HOMBRE' and a.generos&&array['HOMBRE','AMBOS'])
        or (p_genero='MUJER' and a.generos&&array['MUJER','AMBOS']) or (p_genero='AMBOS' and 'AMBOS'=any(a.generos)))
      and (nullif(trim(p_busqueda),'') is null or position(lower(trim(p_busqueda)) in lower(concat_ws(' ',a.personal->>'nombre',a.personal->>'dni',a.clientes->>'nombre',a.unidades->>'nombre',a.puestos->>'nombre',a.profiles->>'nombre',a.profiles->>'email',a.id::text)))>0)
  ), filtered as (select * from scoped where not p_solo_duplicados or posible_duplicado), ranked as (
    select f.*,row_number() over(order by
      case when p_orden='fecha' and p_direccion='asc' then fecha end asc,case when p_orden='fecha' and p_direccion='desc' then fecha end desc,
      case when p_orden='agente' and p_direccion='asc' then agente_orden end asc,case when p_orden='agente' and p_direccion='desc' then agente_orden end desc,
      case when p_orden='cliente' and p_direccion='asc' then cliente_orden end asc,case when p_orden='cliente' and p_direccion='desc' then cliente_orden end desc,
      case when p_orden='unidad' and p_direccion='asc' then unidad_orden end asc,case when p_orden='unidad' and p_direccion='desc' then unidad_orden end desc,
      case when p_orden='coordinador' and p_direccion='asc' then coordinador_orden end asc,case when p_orden='coordinador' and p_direccion='desc' then coordinador_orden end desc,
      case when p_orden='estado' and p_direccion='asc' then estado::text end asc,case when p_orden='estado' and p_direccion='desc' then estado::text end desc,
      case when p_orden='prendas' and p_direccion='asc' then cantidad_prendas end asc,case when p_orden='prendas' and p_direccion='desc' then cantidad_prendas end desc,
      case when p_orden='total' and p_direccion='asc' then total_requerimiento end asc,case when p_orden='total' and p_direccion='desc' then total_requerimiento end desc,id) posicion
    from filtered f where p_cursor_fecha is null or (fecha,id)<(p_cursor_fecha,p_cursor_id)
  ), page as (select * from ranked order by posicion limit p_limite offset p_offset)
  select jsonb_build_object('total',case when p_exportar then null else (select count(*) from filtered) end,
    'duplicate_total',(select count(*) from scoped where posible_duplicado),'duplicate_groups',(select count(distinct grupo_duplicado_id) from scoped where posible_duplicado),
    'rows',coalesce((select jsonb_agg((to_jsonb(r)-'agente_orden'-'cliente_orden'-'unidad_orden'-'coordinador_orden'-'posicion') ||
      case when p_exportar then jsonb_build_object('detalle_requerimiento',coalesce(d.detalles,'[]')) else '{}'::jsonb end order by r.posicion)
      from page r left join lateral (
        select jsonb_agg(jsonb_build_object('id',dr.id,'created_at',dr.created_at,'cantidad',dr.cantidad,
          'precio_unitario',dr.precio_unitario,'codigo_almacen',dr.codigo_almacen,
          'prendas',jsonb_build_object('codigo_prenda',g.codigo_prenda,'nombre_prenda',g.nombre_prenda,'codigo_almacen',g.codigo_almacen)) order by dr.created_at,dr.id) detalles
        from public.detalle_requerimiento dr left join public.prendas g on g.id=dr.prenda_id where dr.requerimiento_id=r.id and dr.activo
      ) d on true),'[]'::jsonb)) into v_result;
  return v_result;
end $function$;

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
      select count(*) into v_total from public.prendas p where
        exists(select 1 from public.prenda_clientes a where a.prenda_id=p.id
          and (p_cliente_id is null or a.cliente_id=p_cliente_id) and (p_genero is null or a.genero=p_genero))
        and (v_q='' or position(v_q in lower(concat_ws(' ',p.codigo_prenda,p.nombre_prenda,p.codigo_almacen)))>0);
      select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre_prenda,x.id),'[]') into v_rows from (
        select p.id,p.codigo_prenda,p.nombre_prenda,p.codigo_almacen,p.precio,p.activo,
          coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'cliente_id',a.cliente_id,'cliente',c.nombre,
            'puesto_id',a.puesto_id,'puesto',pu.nombre,'renovacion',a.renovacion,'genero',a.genero,'cantidad',a.cantidad,'activo',a.activo) order by c.nombre,pu.nombre nulls first,a.renovacion)
            from public.prenda_clientes a join public.clientes c on c.id=a.cliente_id
            left join public.puestos pu on pu.id=a.puesto_id where a.prenda_id=p.id),'[]'::jsonb) asignaciones
        from public.prendas p where
          exists(select 1 from public.prenda_clientes a where a.prenda_id=p.id
            and (p_cliente_id is null or a.cliente_id=p_cliente_id) and (p_genero is null or a.genero=p_genero))
          and (v_q='' or position(v_q in lower(concat_ws(' ',p.codigo_prenda,p.nombre_prenda,p.codigo_almacen)))>0)
        order by p.nombre_prenda,p.id limit p_limite offset p_offset) x;
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

CREATE OR REPLACE FUNCTION private.admin_actualizar_catalogo_activo(p_catalogo text, p_id uuid, p_activo boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v_antes jsonb; v_despues jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_catalogo not in ('clientes','unidades','personal','prendas','provincias','puestos','cargos') or p_id is null or p_activo is null then
    raise exception 'Datos inválidos' using errcode='22023';
  end if;
  case p_catalogo
    when 'clientes' then select to_jsonb(c.*) into v_antes from public.clientes c where c.id=p_id for update;
    when 'unidades' then select to_jsonb(u.*) into v_antes from public.unidades u where u.id=p_id for update;
    when 'personal' then select to_jsonb(p.*) into v_antes from public.personal p where p.id=p_id for update;
    when 'prendas' then select to_jsonb(p.*) into v_antes from public.prendas p where p.id=p_id for update;
    when 'provincias' then select to_jsonb(p.*) into v_antes from public.provincias p where p.id=p_id for update;
    when 'puestos' then select to_jsonb(pu.*) into v_antes from public.puestos pu where pu.id=p_id for update;
    when 'cargos' then select to_jsonb(c.*) into v_antes from public.cargos c where c.id=p_id for update;
  end case;
  if v_antes is null then raise exception 'Registro no encontrado' using errcode='P0002'; end if;
  if p_catalogo='unidades' and p_activo and not exists(
    select 1 from public.clientes c where c.id=(v_antes->>'cliente_id')::uuid and c.activo
  ) then raise exception 'Reactiva el cliente antes de activar esta unidad' using errcode='55000'; end if;
  case p_catalogo
    when 'clientes' then update public.clientes set activo=p_activo where id=p_id returning to_jsonb(clientes.*) into v_despues;
    when 'unidades' then update public.unidades set activo=p_activo where id=p_id returning to_jsonb(unidades.*) into v_despues;
    when 'personal' then update public.personal set activo=p_activo where id=p_id returning to_jsonb(personal.*) into v_despues;
    when 'prendas' then update public.prendas set activo=p_activo where id=p_id returning to_jsonb(prendas.*) into v_despues;
    when 'provincias' then update public.provincias set activo=p_activo where id=p_id returning to_jsonb(provincias.*) into v_despues;
    when 'puestos' then update public.puestos set activo=p_activo where id=p_id returning to_jsonb(puestos.*) into v_despues;
    when 'cargos' then update public.cargos set activo=p_activo,updated_at=now() where id=p_id returning to_jsonb(cargos.*) into v_despues;
  end case;
  insert into private.admin_catalog_audit(usuario_id,accion,catalogo,registro_id,valores_antes,valores_despues)
  values(auth.uid(),case when p_activo then 'ACTIVAR' else 'DESACTIVAR' end,p_catalogo,p_id,v_antes,v_despues);
  return v_despues;
end $function$;

CREATE OR REPLACE FUNCTION private.admin_importar_personal(p_filas jsonb, p_aplicar boolean, p_actualizar jsonb DEFAULT '[]'::jsonb, p_cargo_defecto text DEFAULT 'AGENTE'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
  v_cargo:=coalesce((select c.nombre from public.cargos c where lower(c.nombre)=lower(v_cargo)),v_cargo);

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
  -- Cargos: el del archivo (o el cargo por defecto de las personas nuevas) debe existir y estar activo en el catálogo.
  update pg_temp.imp_mt m set cargo=c.nombre from public.cargos c where m.cargo is not null and lower(c.nombre)=lower(m.cargo);
  insert into pg_temp.imp_e
    select m.fila,m.codigo,'El cargo "'||coalesce(m.cargo,v_cargo)||'" no existe en el catálogo de cargos o está inactivo'
    from pg_temp.imp_mt m
    where (m.cargo is not null or m.pid is null)
      and not (m.pid is not null and lower(btrim(m.cargo_act))=lower(m.cargo))
      and not exists(select 1 from public.cargos c where c.nombre=coalesce(m.cargo,v_cargo) and c.activo);
  select coalesce(jsonb_agg(jsonb_build_object('fila',e.fila,'codigo',e.codigo,'mensaje',e.mensaje) order by e.fila,e.mensaje),'[]'::jsonb)
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
end $function$;


create function public.editar_cabecera_requerimiento(p_id uuid, p_renovacion text default null, p_cargo text default null, p_lineas_confirmadas uuid[] default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  v_row public.requerimientos; v_ficha text; v_cargo text; v_ids uuid[]; v_lineas jsonb;
  v_ren text; v_cambia_ren boolean; v_cambia_cargo boolean; v_ref text;
begin
  -- Mismas reglas que la edición de prendas: admin/superadmin cualquiera; coordinador solo los suyos. Bloquea la cabecera.
  select r.* into v_row from public.requerimientos r
    join public.profiles p on p.id=auth.uid()
    where r.id=p_id and (p.role in ('admin','superadmin') or (p.role='coordinador' and r.usuario_creador_id=p.id))
    for update of r;
  if not found then raise exception 'No autorizado' using errcode='42501'; end if;
  if v_row.estado not in ('Pendiente','Observado') then
    raise exception 'Este requerimiento ya fue atendido y no puede modificarse.' using errcode='55000';
  end if;
  if p_renovacion is null and p_cargo is null then raise exception 'No hay cambios que guardar' using errcode='22023'; end if;
  if p_renovacion is not null and p_renovacion not in ('VERANO','INVIERNO') then
    raise exception 'La renovación debe ser Verano o Invierno' using errcode='22023'; end if;
  if p_lineas_confirmadas is not null and cardinality(p_lineas_confirmadas)>500 then
    raise exception 'Solicitud inválida' using errcode='22023'; end if;
  select p.cargo into v_ficha from public.personal p where p.id=v_row.agente_id for update;
  v_ren:=coalesce(p_renovacion,v_row.renovacion);
  v_cambia_ren:=v_ren<>v_row.renovacion;

  -- Cargo: debe existir y estar activo, salvo que no cambie nada (ni la copia ni la ficha).
  v_cargo:=null; v_cambia_cargo:=false;
  if p_cargo is not null then
    select c.nombre into v_cargo from public.cargos c where lower(c.nombre)=lower(btrim(p_cargo));
    if not found then raise exception 'El cargo no existe en el catálogo de cargos' using errcode='22023'; end if;
    v_cambia_cargo:=v_cargo is distinct from v_row.cargo or v_cargo is distinct from v_ficha;
    if v_cambia_cargo and not exists(select 1 from public.cargos c where c.nombre=v_cargo and c.activo) then
      raise exception 'El cargo está inactivo: elige un cargo activo' using errcode='22023'; end if;
  end if;

  -- Renovación: líneas activas cuya prenda no está asignada (activa) a este cliente y puesto para la nueva renovación o AMBOS.
  v_lineas:='[]'::jsonb; v_ids:='{}';
  if v_cambia_ren then
    if v_row.cliente_id is null then
      raise exception 'Este requerimiento histórico no tiene cliente: no se puede cambiar su renovación' using errcode='55000'; end if;
    select coalesce(array_agg(x.id order by x.created_at,x.id),'{}'),
           coalesce(jsonb_agg(jsonb_build_object('id',x.id,'prenda_id',x.prenda_id,'codigo',x.codigo_prenda,'nombre',x.nombre_prenda,'cantidad',x.cantidad)
             order by x.created_at,x.id),'[]'::jsonb)
      into v_ids,v_lineas
      from (select d.id,d.created_at,d.prenda_id,d.cantidad,g.codigo_prenda,g.nombre_prenda
        from public.detalle_requerimiento d join public.prendas g on g.id=d.prenda_id
        where d.requerimiento_id=p_id and d.activo and not exists(
          select 1 from public.prenda_clientes a where a.prenda_id=d.prenda_id and a.cliente_id=v_row.cliente_id and a.activo
            and a.puesto_id is not distinct from v_row.puesto_id and a.renovacion in (v_ren,'AMBOS'))) x;
    if cardinality(v_ids)>0 and (p_lineas_confirmadas is null
      or (select array_agg(i order by i) from unnest(p_lineas_confirmadas) i) is distinct from (select array_agg(i order by i) from unnest(v_ids) i)) then
      -- Nada se modifica: la pantalla muestra la lista y vuelve a llamar confirmándola.
      return jsonb_build_object('requiere_confirmacion',true,'lineas',v_lineas);
    end if;
  end if;

  if not v_cambia_ren and not v_cambia_cargo then
    return jsonb_build_object('ok',true,'sin_cambios',true,'data',public.obtener_edicion_prendas(p_id));
  end if;

  v_ref:=case when v_cambia_ren then 'RENOVACION '||v_ren else v_row.referencia_interna end;
  perform pg_catalog.set_config('app.edicion_cabecera','on',true);
  update public.requerimientos set renovacion=v_ren,referencia_interna=v_ref,cargo=case when v_cambia_cargo then v_cargo else cargo end where id=p_id;
  perform pg_catalog.set_config('app.edicion_cabecera','off',true);
  if cardinality(v_ids)>0 then
    update public.detalle_requerimiento d set activo=false,retirado_at=clock_timestamp(),retirado_por=auth.uid()
      where d.requerimiento_id=p_id and d.activo and d.id=any(v_ids);
  end if;
  if v_cambia_cargo and v_cargo is distinct from v_ficha then
    update public.personal set cargo=v_cargo where id=v_row.agente_id;
    insert into private.admin_catalog_audit(usuario_id,accion,catalogo,registro_id,valores_antes,valores_despues)
      values(auth.uid(),'EDITAR','personal',v_row.agente_id,jsonb_build_object('cargo',v_ficha),
        jsonb_build_object('cargo',v_cargo,'origen','editar_requerimiento','requerimiento_id',p_id));
  end if;
  insert into public.requerimiento_cambios(requerimiento_id,usuario_id,renovacion_antes,renovacion_despues,referencia_antes,referencia_despues,
      cargo_antes,cargo_despues,cargo_ficha_antes,lineas_quitadas)
    values(p_id,auth.uid(),case when v_cambia_ren then v_row.renovacion end,case when v_cambia_ren then v_ren end,
      case when v_cambia_ren then v_row.referencia_interna end,case when v_cambia_ren then v_ref end,
      case when v_cambia_cargo then v_row.cargo end,case when v_cambia_cargo then v_cargo end,case when v_cambia_cargo then v_ficha end,v_lineas);
  return jsonb_build_object('ok',true,'data',public.obtener_edicion_prendas(p_id));
end $$;
revoke all on function public.editar_cabecera_requerimiento(uuid,text,text,uuid[]) from public,anon,authenticated;
grant execute on function public.editar_cabecera_requerimiento(uuid,text,text,uuid[]) to authenticated;

notify pgrst,'reload schema';
commit;
