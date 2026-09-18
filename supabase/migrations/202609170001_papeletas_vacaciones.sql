-- Submódulo Documentación → Vacaciones → Registrar papeleta.
-- Entidad propia, independiente de documentos/documento_firmas. No modifica ese módulo,
-- solo agrega políticas de lectura histórica adicionales (aditivas) sobre catálogos existentes.
-- Ejecutar después de 202609160002_requerimientos_filtros.sql.
begin;

-- Catálogo incremental de provincias, administrado luego desde Mantenimiento (ver
-- 202609180001_admin_catalogo_provincias.sql). Carga inicial mínima y real de la operación.
create table public.provincias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(btrim(nombre)) between 1 and 200),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create index provincias_activas_nombre_idx on public.provincias(nombre) where activo;
-- Unicidad lógica case-insensitive y sin espacios al borde: "Lima", "LIMA" y " lima " son
-- la misma provincia. El nombre visible se conserva tal como se escribió (solo trim).
create unique index provincias_nombre_ci_uidx on public.provincias(lower(btrim(nombre)));

insert into public.provincias(nombre) values ('Lima'),('Huacho'),('Ica'),('Arequipa')
on conflict (lower(btrim(nombre))) do nothing;

create type public.papeleta_estado as enum ('REGISTRADO');

create table public.papeletas_vacaciones (
  id uuid primary key default gen_random_uuid(),
  -- Clave de idempotencia generada una sola vez por el formulario (mismo principio que
  -- requerimientos.request_id): un reintento del mismo coordinador con el mismo request_id
  -- devuelve la papeleta ya creada en vez de insertar una segunda fila.
  request_id uuid not null,
  colaborador_id uuid not null references public.personal(id),
  -- Snapshot solo del colaborador (identidad legal del documento): se pide explícitamente
  -- y debe seguir siendo legible aunque el registro de personal cambie o se desactive.
  -- Reemplazo/cliente/unidad/provincia/coordinador se leen en vivo vía FK, igual que en
  -- el módulo documental existente; las políticas "historial" de abajo evitan que RLS
  -- rompa esa lectura si el catálogo referenciado se desactiva más adelante.
  colaborador_nombre text not null check (char_length(colaborador_nombre) between 1 and 200),
  colaborador_codigo text not null check (char_length(colaborador_codigo) between 1 and 60),
  fisicas_fecha_inicio date not null,
  fisicas_fecha_fin date not null,
  fisicas_dias integer generated always as (fisicas_fecha_fin - fisicas_fecha_inicio + 1) stored,
  tiene_venta boolean not null default false,
  venta_fecha_inicio date,
  venta_fecha_fin date,
  venta_dias integer generated always as (venta_fecha_fin - venta_fecha_inicio + 1) stored,
  reemplazo_id uuid not null references public.personal(id),
  provincia_id uuid not null references public.provincias(id),
  cliente_id uuid not null references public.clientes(id),
  unidad_id uuid not null references public.unidades(id),
  coordinador_id uuid not null references public.profiles(id),
  archivo_path text not null unique,
  archivo_nombre text not null check (char_length(archivo_nombre) between 1 and 180),
  archivo_sha256 text not null check (archivo_sha256 ~ '^[0-9a-f]{64}$'),
  archivo_bytes integer not null check (archivo_bytes between 1 and 15728640),
  estado public.papeleta_estado not null default 'REGISTRADO',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint papeletas_vacaciones_unidad_cliente_fkey foreign key (unidad_id, cliente_id) references public.unidades(id, cliente_id),
  constraint papeletas_vacaciones_reemplazo_distinto check (reemplazo_id <> colaborador_id),
  constraint papeletas_vacaciones_fisicas_rango check (fisicas_fecha_fin >= fisicas_fecha_inicio),
  constraint papeletas_vacaciones_venta_presente check (
    (tiene_venta and venta_fecha_inicio is not null and venta_fecha_fin is not null)
    or (not tiene_venta and venta_fecha_inicio is null and venta_fecha_fin is null)
  ),
  constraint papeletas_vacaciones_venta_rango check (venta_fecha_inicio is null or venta_fecha_fin >= venta_fecha_inicio),
  -- Estrictamente posterior: excluye superposición, cruce y misma fecha que el fin de físicas.
  constraint papeletas_vacaciones_venta_despues_fisicas check (venta_fecha_inicio is null or venta_fecha_inicio > fisicas_fecha_fin)
);
create index papeletas_vacaciones_coordinador_fecha_idx on public.papeletas_vacaciones(coordinador_id,created_at desc);
create index papeletas_vacaciones_colaborador_idx on public.papeletas_vacaciones(colaborador_id);
create index papeletas_vacaciones_cliente_idx on public.papeletas_vacaciones(cliente_id);
-- Idempotencia por coordinador: dos coordinadores distintos pueden generar el mismo UUID de
-- request_id (colisión astronómicamente improbable, pero sin conflicto porque el índice está
-- compuesto) sin pisarse entre sí; el mismo coordinador nunca puede duplicar su propio envío.
create unique index papeletas_vacaciones_coordinador_request_id_unique
  on public.papeletas_vacaciones(coordinador_id,request_id);

-- Solo la RPC de abajo inserta; nadie tiene UPDATE/DELETE directo ni por RLS ni por grant.
-- No hay reescritura de históricos en esta primera versión (sin flujo de revisión todavía).
alter table public.papeletas_vacaciones enable row level security;
alter table public.papeletas_vacaciones force row level security;
create policy papeletas_vacaciones_lectura on public.papeletas_vacaciones for select to authenticated
using (coordinador_id = auth.uid() or public.is_admin());
revoke all on public.papeletas_vacaciones from public,anon,authenticated;
grant select on public.papeletas_vacaciones to authenticated;

alter table public.provincias enable row level security;
create policy provincias_lectura on public.provincias for select to authenticated
using (activo or public.is_admin());
-- Provincias inactivas referenciadas por una papeleta accesible siguen siendo legibles,
-- igual que clientes_historial/unidades_historial para requerimientos.
create policy provincias_historial on public.provincias for select to authenticated
using (exists(select 1 from public.papeletas_vacaciones p where p.provincia_id=provincias.id));
create policy provincias_admin_insert on public.provincias for insert to authenticated
with check (public.is_admin());
create policy provincias_admin_update on public.provincias for update to authenticated
using (public.is_admin()) with check (public.is_admin());
revoke all on public.provincias from public,anon,authenticated;
grant select,insert,update on public.provincias to authenticated;

-- Políticas aditivas: no se toca ni se elimina ninguna política existente de clientes,
-- unidades ni personal. Solo evitan que RLS oculte un destino/colaborador ya usado en una
-- papeleta si luego se desactiva, igual que ya ocurre para requerimientos.
create policy clientes_historial_papeletas on public.clientes for select to authenticated
using (exists(select 1 from public.papeletas_vacaciones p where p.cliente_id=clientes.id));
create policy unidades_historial_papeletas on public.unidades for select to authenticated
using (exists(select 1 from public.papeletas_vacaciones p where p.unidad_id=unidades.id));
create policy personal_historial_papeletas on public.personal for select to authenticated
using (exists(select 1 from public.papeletas_vacaciones p where p.colaborador_id=personal.id or p.reemplazo_id=personal.id));

create function public.registrar_papeleta_vacaciones(
  p_request_id uuid,p_colaborador_id uuid,p_reemplazo_id uuid,p_provincia_id uuid,p_cliente_id uuid,p_unidad_id uuid,
  p_fisicas_inicio date,p_fisicas_fin date,p_tiene_venta boolean,p_venta_inicio date,p_venta_fin date,
  p_archivo_path text,p_archivo_nombre text,p_archivo_sha256 text,p_archivo_bytes integer
) returns uuid language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_colaborador public.personal; v_id uuid;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='coordinador')
    then raise exception 'Solo coordinadores pueden registrar papeletas de vacaciones' using errcode='42501'; end if;
  if p_request_id is null then raise exception 'Solicitud inválida' using errcode='22023'; end if;

  -- Serializa únicamente reintentos de la misma solicitud del mismo coordinador (doble clic,
  -- reintento del navegador, timeout con respuesta perdida). Mismo principio que crear_requerimiento.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('papeleta:'||auth.uid()::text||':'||p_request_id::text,0));
  select id into v_id from public.papeletas_vacaciones
    where coordinador_id=auth.uid() and request_id=p_request_id;
  if found then return v_id; end if;

  select * into v_colaborador from public.personal where id=p_colaborador_id and activo for share;
  if not found then raise exception 'Colaborador inválido o inactivo' using errcode='22023'; end if;
  if p_reemplazo_id=p_colaborador_id then raise exception 'El reemplazo no puede ser el mismo colaborador' using errcode='22023'; end if;
  if not exists(select 1 from public.personal where id=p_reemplazo_id and activo) then
    raise exception 'Reemplazo inválido o inactivo' using errcode='22023'; end if;
  if not exists(select 1 from public.provincias where id=p_provincia_id and activo) then
    raise exception 'Provincia inválida o inactiva' using errcode='22023'; end if;
  if not exists(select 1 from public.clientes where id=p_cliente_id and activo) then
    raise exception 'Cliente inválido o inactivo' using errcode='22023'; end if;
  if not exists(select 1 from public.unidades where id=p_unidad_id and cliente_id=p_cliente_id and activo) then
    raise exception 'Unidad inválida o no pertenece al cliente' using errcode='22023'; end if;

  if p_fisicas_inicio is null or p_fisicas_fin is null or p_fisicas_fin<p_fisicas_inicio then
    raise exception 'Rango de vacaciones físicas inválido' using errcode='22023'; end if;
  if p_tiene_venta then
    if p_venta_inicio is null or p_venta_fin is null or p_venta_fin<p_venta_inicio or p_venta_inicio<=p_fisicas_fin then
      raise exception 'La venta de vacaciones debe iniciar después del fin de las físicas, sin cruces ni la misma fecha' using errcode='22023'; end if;
  elsif p_venta_inicio is not null or p_venta_fin is not null then
    raise exception 'No se permiten fechas de venta sin activar la venta de vacaciones' using errcode='22023';
  end if;

  -- El path depende de request_id, no de un id aleatorio por intento: un reintento sube
  -- siempre al mismo objeto de Storage, así que nunca puede quedar un PDF huérfano distinto.
  if p_archivo_path<>auth.uid()::text||'/'||p_request_id::text||'.pdf' or p_archivo_sha256!~'^[0-9a-f]{64}$'
    or p_archivo_bytes not between 1 and 15728640 or char_length(btrim(coalesce(p_archivo_nombre,''))) not between 1 and 180
    then raise exception 'Documento inválido' using errcode='22023'; end if;

  insert into public.papeletas_vacaciones(
    request_id,colaborador_id,colaborador_nombre,colaborador_codigo,
    fisicas_fecha_inicio,fisicas_fecha_fin,tiene_venta,venta_fecha_inicio,venta_fecha_fin,
    reemplazo_id,provincia_id,cliente_id,unidad_id,coordinador_id,
    archivo_path,archivo_nombre,archivo_sha256,archivo_bytes
  ) values (
    p_request_id,p_colaborador_id,v_colaborador.nombre,v_colaborador.codigo_personal,
    p_fisicas_inicio,p_fisicas_fin,p_tiene_venta,p_venta_inicio,p_venta_fin,
    p_reemplazo_id,p_provincia_id,p_cliente_id,p_unidad_id,auth.uid(),
    p_archivo_path,btrim(p_archivo_nombre),p_archivo_sha256,p_archivo_bytes
  ) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.registrar_papeleta_vacaciones(uuid,uuid,uuid,uuid,uuid,uuid,date,date,boolean,date,date,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.registrar_papeleta_vacaciones(uuid,uuid,uuid,uuid,uuid,uuid,date,date,boolean,date,date,text,text,text,integer) to authenticated;

-- Bucket privado dedicado: no comparte carpetas ni políticas con documentos-firma.
do $$ begin if to_regclass('storage.buckets') is not null then
 insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('papeletas-vacaciones','papeletas-vacaciones',false,15728640,array['application/pdf'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
 end if; end $$;
do $$ begin if to_regclass('storage.objects') is not null then
 execute $p$create policy papeletas_storage_insert on storage.objects for insert to authenticated
  with check(bucket_id='papeletas-vacaciones' and (storage.foldername(name))[1]=auth.uid()::text)$p$;
 execute $p$create policy papeletas_storage_select on storage.objects for select to authenticated
  using(bucket_id='papeletas-vacaciones' and exists(
   select 1 from public.papeletas_vacaciones p where p.archivo_path=name and (p.coordinador_id=auth.uid() or public.is_admin())
  ))$p$;
 execute $p$create policy papeletas_storage_delete_huerfanos on storage.objects for delete to authenticated
  using(bucket_id='papeletas-vacaciones' and (storage.foldername(name))[1]=auth.uid()::text
   and not exists(select 1 from public.papeletas_vacaciones p where p.archivo_path=name))$p$;
 end if; end $$;

notify pgrst,'reload schema';
commit;
