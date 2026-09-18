-- Flujo de revisión/observación para papeletas de vacaciones, con versionado inmutable.
-- 202609170001 y 202609180001 YA ESTÁN APLICADAS: no se modifican ni se repiten. Este archivo
-- solo agrega objetos nuevos y redefine (CREATE OR REPLACE / DROP POLICY + CREATE POLICY) lo
-- estrictamente necesario para integrar revisión, igual que 202609180001 hizo con el CRUD.
-- Ejecutar después de 202609180001_admin_catalogo_provincias.sql.

-- ALTER TYPE ... ADD VALUE no puede combinarse con su uso en la misma transacción, así que va
-- fuera de begin/commit, igual que el patrón ya usado para agregar 'gerente' a user_role.
alter type public.papeleta_estado add value if not exists 'OBSERVADO';
alter type public.papeleta_estado add value if not exists 'CONFORME';

begin;

alter table public.papeletas_vacaciones
  add column version_actual integer not null default 1,
  add column motivo_observacion text check (motivo_observacion is null or char_length(motivo_observacion) between 1 and 1000),
  add column observado_por uuid references public.profiles(id),
  add column observado_at timestamptz;

-- Snapshots inmutables de cada versión (la 1 es la registrada originalmente). No hay UPDATE ni
-- DELETE de aplicación: fuerza a nunca sobrescribir ni borrar un PDF o datos históricos.
create table public.papeletas_vacaciones_versiones (
  id uuid primary key default gen_random_uuid(),
  papeleta_id uuid not null references public.papeletas_vacaciones(id),
  version integer not null check (version > 0),
  colaborador_id uuid not null references public.personal(id),
  colaborador_nombre text not null check (char_length(colaborador_nombre) between 1 and 200),
  colaborador_codigo text not null check (char_length(colaborador_codigo) between 1 and 60),
  fisicas_fecha_inicio date not null,
  fisicas_fecha_fin date not null,
  fisicas_dias integer not null,
  tiene_venta boolean not null,
  venta_fecha_inicio date,
  venta_fecha_fin date,
  venta_dias integer,
  reemplazo_id uuid not null references public.personal(id),
  provincia_id uuid not null references public.provincias(id),
  cliente_id uuid not null references public.clientes(id),
  unidad_id uuid not null references public.unidades(id),
  archivo_path text not null unique,
  archivo_nombre text not null check (char_length(archivo_nombre) between 1 and 180),
  archivo_sha256 text not null check (archivo_sha256 ~ '^[0-9a-f]{64}$'),
  archivo_bytes integer not null check (archivo_bytes between 1 and 15728640),
  creado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (papeleta_id, version)
);
create index papeletas_vacaciones_versiones_papeleta_idx on public.papeletas_vacaciones_versiones(papeleta_id, version desc);

create function private.proteger_version_papeleta() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  raise exception 'Las versiones de una papeleta son inmutables' using errcode='55000';
end $$;
create trigger proteger_version_papeleta before update or delete on public.papeletas_vacaciones_versiones
for each row execute function private.proteger_version_papeleta();

-- Auditoría de cada acción de revisión, mismo patrón que documento_eventos.
create table public.papeletas_vacaciones_eventos (
  id bigint generated always as identity primary key,
  papeleta_id uuid not null references public.papeletas_vacaciones(id),
  usuario_id uuid not null references public.profiles(id),
  accion text not null check (accion in ('REGISTRADO','OBSERVADO','CORREGIDO','CONFORME')),
  estado_anterior public.papeleta_estado,
  estado_nuevo public.papeleta_estado,
  version integer,
  motivo text check (motivo is null or char_length(motivo) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index papeletas_vacaciones_eventos_papeleta_fecha_idx on public.papeletas_vacaciones_eventos(papeleta_id, created_at desc);

alter table public.papeletas_vacaciones_versiones enable row level security;
alter table public.papeletas_vacaciones_versiones force row level security;
alter table public.papeletas_vacaciones_eventos enable row level security;
alter table public.papeletas_vacaciones_eventos force row level security;
create policy papeletas_vacaciones_versiones_lectura on public.papeletas_vacaciones_versiones for select to authenticated
using (exists(select 1 from public.papeletas_vacaciones p where p.id=papeleta_id
  and (p.coordinador_id=auth.uid() or public.is_admin() or private.es_gerente())));
create policy papeletas_vacaciones_eventos_lectura on public.papeletas_vacaciones_eventos for select to authenticated
using (exists(select 1 from public.papeletas_vacaciones p where p.id=papeleta_id
  and (p.coordinador_id=auth.uid() or public.is_admin() or private.es_gerente())));
revoke all on public.papeletas_vacaciones_versiones, public.papeletas_vacaciones_eventos from public,anon,authenticated;
grant select on public.papeletas_vacaciones_versiones, public.papeletas_vacaciones_eventos to authenticated;
revoke all on sequence public.papeletas_vacaciones_eventos_id_seq from public,anon,authenticated;

-- Gerente ahora también revisa (observa/marca conforme): política aditiva sobre la tabla
-- principal, reemplaza solo la política de lectura de 202609170001 (no se toca ese archivo).
drop policy papeletas_vacaciones_lectura on public.papeletas_vacaciones;
create policy papeletas_vacaciones_lectura on public.papeletas_vacaciones for select to authenticated
using (coordinador_id = auth.uid() or public.is_admin() or private.es_gerente());

-- registrar_papeleta_vacaciones conserva firma y validaciones íntegras; solo se agrega el
-- registro de la versión 1 y su evento, para que toda papeleta nueva quede versionada desde
-- el origen exactamente igual que las ya existentes (ver backfill más abajo).
create or replace function public.registrar_papeleta_vacaciones(
  p_request_id uuid,p_colaborador_id uuid,p_reemplazo_id uuid,p_provincia_id uuid,p_cliente_id uuid,p_unidad_id uuid,
  p_fisicas_inicio date,p_fisicas_fin date,p_tiene_venta boolean,p_venta_inicio date,p_venta_fin date,
  p_archivo_path text,p_archivo_nombre text,p_archivo_sha256 text,p_archivo_bytes integer
) returns uuid language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_colaborador public.personal; v_id uuid;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='coordinador')
    then raise exception 'Solo coordinadores pueden registrar papeletas de vacaciones' using errcode='42501'; end if;
  if p_request_id is null then raise exception 'Solicitud inválida' using errcode='22023'; end if;

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

  insert into public.papeletas_vacaciones_versiones(
    papeleta_id,version,colaborador_id,colaborador_nombre,colaborador_codigo,
    fisicas_fecha_inicio,fisicas_fecha_fin,fisicas_dias,tiene_venta,venta_fecha_inicio,venta_fecha_fin,venta_dias,
    reemplazo_id,provincia_id,cliente_id,unidad_id,
    archivo_path,archivo_nombre,archivo_sha256,archivo_bytes,creado_por
  ) values (
    v_id,1,p_colaborador_id,v_colaborador.nombre,v_colaborador.codigo_personal,
    p_fisicas_inicio,p_fisicas_fin,(p_fisicas_fin-p_fisicas_inicio+1),
    p_tiene_venta,p_venta_inicio,p_venta_fin,case when p_venta_inicio is not null then (p_venta_fin-p_venta_inicio+1) end,
    p_reemplazo_id,p_provincia_id,p_cliente_id,p_unidad_id,
    p_archivo_path,btrim(p_archivo_nombre),p_archivo_sha256,p_archivo_bytes,auth.uid()
  );
  insert into public.papeletas_vacaciones_eventos(papeleta_id,usuario_id,accion,estado_anterior,estado_nuevo,version)
  values (v_id,auth.uid(),'REGISTRADO',null,'REGISTRADO',1);

  return v_id;
end $$;
revoke all on function public.registrar_papeleta_vacaciones(uuid,uuid,uuid,uuid,uuid,uuid,date,date,boolean,date,date,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.registrar_papeleta_vacaciones(uuid,uuid,uuid,uuid,uuid,uuid,date,date,boolean,date,date,text,text,text,integer) to authenticated;

-- Backfill: las papeletas ya registradas en producción antes de esta migración quedan con su
-- versión 1 y evento inicial, sin tocar ninguno de sus datos ni su archivo.
insert into public.papeletas_vacaciones_versiones(
  papeleta_id,version,colaborador_id,colaborador_nombre,colaborador_codigo,
  fisicas_fecha_inicio,fisicas_fecha_fin,fisicas_dias,tiene_venta,venta_fecha_inicio,venta_fecha_fin,venta_dias,
  reemplazo_id,provincia_id,cliente_id,unidad_id,
  archivo_path,archivo_nombre,archivo_sha256,archivo_bytes,creado_por,created_at
)
select id,1,colaborador_id,colaborador_nombre,colaborador_codigo,
  fisicas_fecha_inicio,fisicas_fecha_fin,fisicas_dias,tiene_venta,venta_fecha_inicio,venta_fecha_fin,venta_dias,
  reemplazo_id,provincia_id,cliente_id,unidad_id,
  archivo_path,archivo_nombre,archivo_sha256,archivo_bytes,coordinador_id,created_at
from public.papeletas_vacaciones
on conflict (papeleta_id,version) do nothing;

insert into public.papeletas_vacaciones_eventos(papeleta_id,usuario_id,accion,estado_anterior,estado_nuevo,version,created_at)
select p.id,p.coordinador_id,'REGISTRADO',null,'REGISTRADO',1,p.created_at
from public.papeletas_vacaciones p
where not exists(select 1 from public.papeletas_vacaciones_eventos e where e.papeleta_id=p.id);

-- Admin o gerente observa (obligatorio motivo) o marca conforme una papeleta REGISTRADO.
-- Ninguno de los dos puede revisar su propia papeleta (defensa adicional: hoy es estructuralmente
-- imposible porque solo coordinador registra, pero se deja explícito si el modelo de roles cambia).
create function public.observar_papeleta_vacaciones(p_papeleta_id uuid,p_motivo text)
returns void language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_doc public.papeletas_vacaciones; v_motivo text;
begin
  if auth.uid() is null or not (public.is_admin() or private.es_gerente()) then
    raise exception 'Solo administradores o gerentes pueden observar' using errcode='42501'; end if;
  v_motivo:=nullif(btrim(p_motivo),'');
  if v_motivo is null or char_length(v_motivo)>1000 then
    raise exception 'El motivo de observación es obligatorio' using errcode='22023'; end if;
  select * into v_doc from public.papeletas_vacaciones where id=p_papeleta_id for update;
  if not found then raise exception 'Papeleta no encontrada' using errcode='P0002'; end if;
  if v_doc.coordinador_id=auth.uid() then raise exception 'No puedes observar tu propia papeleta' using errcode='42501'; end if;
  if v_doc.estado<>'REGISTRADO' then raise exception 'Solo puede observarse una papeleta registrada' using errcode='55000'; end if;
  update public.papeletas_vacaciones set estado='OBSERVADO',motivo_observacion=v_motivo,
    observado_por=auth.uid(),observado_at=now(),updated_at=now() where id=p_papeleta_id;
  insert into public.papeletas_vacaciones_eventos(papeleta_id,usuario_id,accion,estado_anterior,estado_nuevo,version,motivo)
  values (p_papeleta_id,auth.uid(),'OBSERVADO','REGISTRADO','OBSERVADO',v_doc.version_actual,v_motivo);
end $$;
revoke all on function public.observar_papeleta_vacaciones(uuid,text) from public,anon,authenticated;
grant execute on function public.observar_papeleta_vacaciones(uuid,text) to authenticated;

create function public.marcar_conforme_papeleta_vacaciones(p_papeleta_id uuid)
returns void language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_doc public.papeletas_vacaciones;
begin
  if auth.uid() is null or not (public.is_admin() or private.es_gerente()) then
    raise exception 'Solo administradores o gerentes pueden marcar conforme' using errcode='42501'; end if;
  select * into v_doc from public.papeletas_vacaciones where id=p_papeleta_id for update;
  if not found then raise exception 'Papeleta no encontrada' using errcode='P0002'; end if;
  if v_doc.coordinador_id=auth.uid() then raise exception 'No puedes revisar tu propia papeleta' using errcode='42501'; end if;
  if v_doc.estado<>'REGISTRADO' then raise exception 'Solo puede marcarse conforme una papeleta registrada' using errcode='55000'; end if;
  update public.papeletas_vacaciones set estado='CONFORME',motivo_observacion=null,updated_at=now() where id=p_papeleta_id;
  insert into public.papeletas_vacaciones_eventos(papeleta_id,usuario_id,accion,estado_anterior,estado_nuevo,version)
  values (p_papeleta_id,auth.uid(),'CONFORME','REGISTRADO','CONFORME',v_doc.version_actual);
end $$;
revoke all on function public.marcar_conforme_papeleta_vacaciones(uuid) from public,anon,authenticated;
grant execute on function public.marcar_conforme_papeleta_vacaciones(uuid) to authenticated;

-- Coordinador corrige una papeleta OBSERVADO: crea una versión nueva, jamás sobrescribe la
-- anterior. colaborador_id NO es parámetro: se mantiene fijo a propósito (ver documentación).
-- p_version_esperada implementa concurrencia optimista, mismo principio que editar_prendas_requerimiento.
create function public.corregir_papeleta_vacaciones(
  p_papeleta_id uuid,p_version_esperada integer,
  p_reemplazo_id uuid,p_provincia_id uuid,p_cliente_id uuid,p_unidad_id uuid,
  p_fisicas_inicio date,p_fisicas_fin date,p_tiene_venta boolean,p_venta_inicio date,p_venta_fin date,
  p_archivo_path text,p_archivo_nombre text,p_archivo_sha256 text,p_archivo_bytes integer
) returns uuid language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_doc public.papeletas_vacaciones; v_colaborador public.personal; v_version integer;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='coordinador')
    then raise exception 'Solo el coordinador puede corregir su papeleta' using errcode='42501'; end if;
  select * into v_doc from public.papeletas_vacaciones where id=p_papeleta_id for update;
  if not found then raise exception 'Papeleta no encontrada' using errcode='P0002'; end if;
  if v_doc.coordinador_id<>auth.uid() then raise exception 'No autorizado' using errcode='42501'; end if;
  if v_doc.estado<>'OBSERVADO' then raise exception 'Solo una papeleta observada puede corregirse' using errcode='55000'; end if;
  if p_version_esperada is distinct from v_doc.version_actual then
    raise exception 'La papeleta cambió mientras corregías. Recarga antes de guardar.' using errcode='40001'; end if;

  select * into v_colaborador from public.personal where id=v_doc.colaborador_id and activo for share;
  if not found then raise exception 'El colaborador de esta papeleta ya no está activo; no se puede corregir' using errcode='55000'; end if;
  if p_reemplazo_id=v_doc.colaborador_id then raise exception 'El reemplazo no puede ser el mismo colaborador' using errcode='22023'; end if;
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

  v_version:=v_doc.version_actual+1;
  if p_archivo_path<>auth.uid()::text||'/'||p_papeleta_id::text||'/v'||v_version::text||'.pdf' or p_archivo_sha256!~'^[0-9a-f]{64}$'
    or p_archivo_bytes not between 1 and 15728640 or char_length(btrim(coalesce(p_archivo_nombre,''))) not between 1 and 180
    then raise exception 'Documento inválido' using errcode='22023'; end if;

  insert into public.papeletas_vacaciones_versiones(
    papeleta_id,version,colaborador_id,colaborador_nombre,colaborador_codigo,
    fisicas_fecha_inicio,fisicas_fecha_fin,fisicas_dias,tiene_venta,venta_fecha_inicio,venta_fecha_fin,venta_dias,
    reemplazo_id,provincia_id,cliente_id,unidad_id,
    archivo_path,archivo_nombre,archivo_sha256,archivo_bytes,creado_por
  ) values (
    p_papeleta_id,v_version,v_doc.colaborador_id,v_colaborador.nombre,v_colaborador.codigo_personal,
    p_fisicas_inicio,p_fisicas_fin,(p_fisicas_fin-p_fisicas_inicio+1),
    p_tiene_venta,p_venta_inicio,p_venta_fin,case when p_venta_inicio is not null then (p_venta_fin-p_venta_inicio+1) end,
    p_reemplazo_id,p_provincia_id,p_cliente_id,p_unidad_id,
    p_archivo_path,btrim(p_archivo_nombre),p_archivo_sha256,p_archivo_bytes,auth.uid()
  );

  update public.papeletas_vacaciones set
    colaborador_nombre=v_colaborador.nombre,colaborador_codigo=v_colaborador.codigo_personal,
    fisicas_fecha_inicio=p_fisicas_inicio,fisicas_fecha_fin=p_fisicas_fin,
    tiene_venta=p_tiene_venta,venta_fecha_inicio=p_venta_inicio,venta_fecha_fin=p_venta_fin,
    reemplazo_id=p_reemplazo_id,provincia_id=p_provincia_id,cliente_id=p_cliente_id,unidad_id=p_unidad_id,
    archivo_path=p_archivo_path,archivo_nombre=btrim(p_archivo_nombre),archivo_sha256=p_archivo_sha256,archivo_bytes=p_archivo_bytes,
    estado='REGISTRADO',motivo_observacion=null,observado_por=null,observado_at=null,
    version_actual=v_version,updated_at=now()
  where id=p_papeleta_id;

  insert into public.papeletas_vacaciones_eventos(papeleta_id,usuario_id,accion,estado_anterior,estado_nuevo,version)
  values (p_papeleta_id,auth.uid(),'CORREGIDO','OBSERVADO','REGISTRADO',v_version);

  return p_papeleta_id;
end $$;
revoke all on function public.corregir_papeleta_vacaciones(uuid,integer,uuid,uuid,uuid,uuid,date,date,boolean,date,date,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.corregir_papeleta_vacaciones(uuid,integer,uuid,uuid,uuid,uuid,date,date,boolean,date,date,text,text,text,integer) to authenticated;

-- Storage: gerente también puede ver el PDF vigente; y los PDFs de versiones anteriores siguen
-- siendo legibles (histórico) aunque el puntero principal ya apunte a la versión corregida.
-- Nunca se sobrescribe ni se permite borrar un archivo de una versión ya registrada.
do $$ begin if to_regclass('storage.objects') is not null then
 execute 'drop policy if exists papeletas_storage_select on storage.objects';
 execute $p$create policy papeletas_storage_select on storage.objects for select to authenticated
  using(bucket_id='papeletas-vacaciones' and exists(
   select 1 from public.papeletas_vacaciones p where p.archivo_path=name
    and (p.coordinador_id=auth.uid() or public.is_admin() or private.es_gerente())
  ))$p$;
 execute $p$create policy papeletas_storage_select_version on storage.objects for select to authenticated
  using(bucket_id='papeletas-vacaciones' and exists(
   select 1 from public.papeletas_vacaciones_versiones v join public.papeletas_vacaciones p on p.id=v.papeleta_id
   where v.archivo_path=name and (p.coordinador_id=auth.uid() or public.is_admin() or private.es_gerente())
  ))$p$;
 execute 'drop policy if exists papeletas_storage_delete_huerfanos on storage.objects';
 execute $p$create policy papeletas_storage_delete_huerfanos on storage.objects for delete to authenticated
  using(bucket_id='papeletas-vacaciones' and (storage.foldername(name))[1]=auth.uid()::text
   and not exists(select 1 from public.papeletas_vacaciones p where p.archivo_path=name)
   and not exists(select 1 from public.papeletas_vacaciones_versiones v where v.archivo_path=name))$p$;
 end if; end $$;

notify pgrst,'reload schema';
commit;
