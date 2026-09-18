-- Evolución del módulo de Vacaciones: firma real del gerente (reutilizando el motor de firma
-- de Documentos: perfiles_firma + lib/documents/pdf.ts) y borrado controlado de pruebas.
-- 202609170001, 202609180001 y 202609190001 YA ESTÁN APLICADAS: no se modifican ni se repiten.
-- Este archivo solo agrega objetos nuevos y redefine (CREATE OR REPLACE / DROP+CREATE POLICY)
-- lo estrictamente necesario, igual que hizo 202609190001 con 202609170001.
-- Ejecutar después de 202609190001_papeletas_revision.sql.

-- FIRMADO se agrega como valor NUEVO del enum (no reemplaza a CONFORME). Primer intento de esta
-- migración usaba `rename value 'CONFORME' to 'FIRMADO'`, pero eso convierte TODA fila CONFORME
-- existente en FIRMADO con el mismo UPDATE implícito (mismo OID) -- y una papeleta CONFORME
-- histórica (creada antes de que existiera la firma real) no tiene gerente firmante, hash final,
-- perfil de firma ni fecha de firma. Aplicado en Supabase real, eso violó de inmediato el check
-- papeletas_vacaciones_firma_coherente (exige esos metadatos cuando estado='FIRMADO') y abortó la
-- migración. CONFORME se conserva tal cual, como estado histórico/legado; FIRMADO es el único
-- estado terminal para papeletas firmadas de verdad de aquí en adelante. No se inventa ningún
-- metadato de firma para el histórico. `add value` no puede ir dentro de la transacción que la
-- usa, igual que 'OBSERVADO'/'CONFORME' en 202609190001.
alter type public.papeleta_estado add value if not exists 'FIRMADO';

begin;

-- Metadatos mínimos de la firma aplicada, exigidos por el requerimiento: gerente firmante,
-- perfil de firma usado (y su versión, porque perfiles_firma es versionado e inmutable),
-- fecha/hora de servidor. Hash y path de Storage ya viven en archivo_sha256/archivo_path
-- (el mismo puntero "versión vigente" que ya usa el flujo de corrección).
alter table public.papeletas_vacaciones
  add column firmado_por uuid references public.profiles(id),
  add column firma_perfil_id uuid references public.perfiles_firma(id),
  add column firma_perfil_version integer,
  add column firmado_at timestamptz,
  add constraint papeletas_vacaciones_firma_coherente check (
    (estado='FIRMADO') = (firmado_por is not null and firma_perfil_id is not null
      and firma_perfil_version is not null and firmado_at is not null)
  ),
  -- Marcado EXPLÍCITO de datos de prueba: nunca se infiere por nombre. Solo admin lo cambia
  -- (ver private.admin_marcar_papeleta_prueba más abajo). Por defecto false: ningún registro
  -- existente pasa a ser "de prueba" por esta migración.
  add column es_prueba boolean not null default false;

-- Tipo de cada versión inmutable, para que el visor sepa qué mostrar como Original / Corrección
-- / Firmado sin tener que adivinarlo por su posición. La versión 1 siempre fue el original; las
-- posteriores ya existentes solo pudieron haberse creado por corregir_papeleta_vacaciones.
alter table public.papeletas_vacaciones_versiones
  add column tipo text not null default 'ORIGINAL' check (tipo in ('ORIGINAL','CORRECCION','FIRMADO'));
update public.papeletas_vacaciones_versiones set tipo='CORRECCION' where version>1;

-- Escape controlado para permitir borrar versiones SOLO durante una eliminación de prueba
-- explícitamente habilitada (ver private.admin_eliminar_papeletas_prueba), mismo principio que
-- private.proteger_historial_detalle ya usa para requerimientos de prueba.
create or replace function private.proteger_version_papeleta() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  if tg_op='DELETE' and pg_catalog.current_setting('app.test_papeleta_deletion',true)='on'
    and auth.uid() is not null and public.is_admin() then
    return old;
  end if;
  raise exception 'Las versiones de una papeleta son inmutables' using errcode='55000';
end $$;

-- El "marcar conforme sin firma real" queda retirado: la única forma de llegar a FIRMADO ahora
-- es public.firmar_papeleta_vacaciones, que exige PDF firmado + perfil de firma real. Su único
-- llamador en la app (VacationReviewActions / accion "conforme") se retira en el mismo cambio.
drop function if exists public.marcar_conforme_papeleta_vacaciones(uuid);

-- Firma del gerente: recibe el PDF YA compuesto (misma técnica que Documentos: pdf-lib +
-- createSignedPdf, generalizado para aceptar el bucket de papeletas, con la colocación que el
-- gerente eligió en el editor interactivo -- nunca una posición fija) y solo registra los
-- metadatos de forma transaccional, igual que corregir_papeleta_vacaciones hace con su archivo.
-- p_archivo_sha256_origen es una segunda verificación de frescura (además de p_version_esperada,
-- y de la que ya hace la capa de aplicación antes de componer el PDF): si el hash de la versión
-- vigente cambió entre que el gerente abrió el editor y confirmó, se rechaza sin firmar nada.
-- Nunca sobreescribe la versión anterior: inserta una versión nueva (tipo FIRMADO) y mueve el
-- puntero "vigente" de la papeleta a esa versión.
create function public.firmar_papeleta_vacaciones(
  p_papeleta_id uuid,p_version_esperada integer,p_archivo_sha256_origen text,p_perfil_firma_id uuid,
  p_archivo_path text,p_archivo_nombre text,p_archivo_sha256 text,p_archivo_bytes integer
) returns uuid language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_doc public.papeletas_vacaciones; v_perfil public.perfiles_firma; v_version integer;
begin
  if auth.uid() is null or not private.es_gerente() then
    raise exception 'Solo el gerente puede firmar' using errcode='42501'; end if;
  select * into v_doc from public.papeletas_vacaciones where id=p_papeleta_id for update;
  if not found then raise exception 'Papeleta no encontrada' using errcode='P0002'; end if;
  if v_doc.coordinador_id=auth.uid() then raise exception 'No puedes firmar tu propia papeleta' using errcode='42501'; end if;
  if v_doc.estado<>'REGISTRADO' then raise exception 'Solo puede firmarse una papeleta pendiente de firma' using errcode='55000'; end if;
  if p_version_esperada is distinct from v_doc.version_actual or p_archivo_sha256_origen is distinct from v_doc.archivo_sha256 then
    raise exception 'La papeleta cambió mientras firmabas. Recarga antes de continuar.' using errcode='40001'; end if;

  select * into v_perfil from public.perfiles_firma where id=p_perfil_firma_id and usuario_id=auth.uid() and activo;
  if not found then raise exception 'Selecciona un perfil de firma activo' using errcode='22023'; end if;

  v_version:=v_doc.version_actual+1;
  if p_archivo_path<>v_doc.coordinador_id::text||'/'||p_papeleta_id::text||'/v'||v_version::text||'.pdf'
    or p_archivo_sha256!~'^[0-9a-f]{64}$' or p_archivo_bytes not between 1 and 15728640
    or char_length(btrim(coalesce(p_archivo_nombre,''))) not between 1 and 180
    then raise exception 'Documento firmado inválido' using errcode='22023'; end if;

  insert into public.papeletas_vacaciones_versiones(
    papeleta_id,version,colaborador_id,colaborador_nombre,colaborador_codigo,
    fisicas_fecha_inicio,fisicas_fecha_fin,fisicas_dias,tiene_venta,venta_fecha_inicio,venta_fecha_fin,venta_dias,
    reemplazo_id,provincia_id,cliente_id,unidad_id,
    archivo_path,archivo_nombre,archivo_sha256,archivo_bytes,creado_por,tipo
  ) values (
    p_papeleta_id,v_version,v_doc.colaborador_id,v_doc.colaborador_nombre,v_doc.colaborador_codigo,
    v_doc.fisicas_fecha_inicio,v_doc.fisicas_fecha_fin,v_doc.fisicas_dias,
    v_doc.tiene_venta,v_doc.venta_fecha_inicio,v_doc.venta_fecha_fin,v_doc.venta_dias,
    v_doc.reemplazo_id,v_doc.provincia_id,v_doc.cliente_id,v_doc.unidad_id,
    p_archivo_path,btrim(p_archivo_nombre),p_archivo_sha256,p_archivo_bytes,auth.uid(),'FIRMADO'
  );

  update public.papeletas_vacaciones set
    archivo_path=p_archivo_path,archivo_nombre=btrim(p_archivo_nombre),archivo_sha256=p_archivo_sha256,archivo_bytes=p_archivo_bytes,
    estado='FIRMADO',version_actual=v_version,
    firmado_por=auth.uid(),firma_perfil_id=p_perfil_firma_id,firma_perfil_version=v_perfil.version,firmado_at=now(),
    updated_at=now()
  where id=p_papeleta_id;

  insert into public.papeletas_vacaciones_eventos(papeleta_id,usuario_id,accion,estado_anterior,estado_nuevo,version)
  values (p_papeleta_id,auth.uid(),'FIRMADO','REGISTRADO','FIRMADO',v_version);

  return p_papeleta_id;
end $$;
revoke all on function public.firmar_papeleta_vacaciones(uuid,integer,text,uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.firmar_papeleta_vacaciones(uuid,integer,text,uuid,text,text,text,integer) to authenticated;

alter table public.papeletas_vacaciones_eventos drop constraint papeletas_vacaciones_eventos_accion_check;
alter table public.papeletas_vacaciones_eventos add constraint papeletas_vacaciones_eventos_accion_check
  check (accion in ('REGISTRADO','OBSERVADO','CORREGIDO','FIRMADO','CONFORME'));

-- corregir_papeleta_vacaciones: sin cambios de negocio, solo deja explícito tipo='CORRECCION'
-- (antes dependía del default de la columna, que se acaba de crear en esta misma migración).
create or replace function public.corregir_papeleta_vacaciones(
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
    archivo_path,archivo_nombre,archivo_sha256,archivo_bytes,creado_por,tipo
  ) values (
    p_papeleta_id,v_version,v_doc.colaborador_id,v_colaborador.nombre,v_colaborador.codigo_personal,
    p_fisicas_inicio,p_fisicas_fin,(p_fisicas_fin-p_fisicas_inicio+1),
    p_tiene_venta,p_venta_inicio,p_venta_fin,case when p_venta_inicio is not null then (p_venta_fin-p_venta_inicio+1) end,
    p_reemplazo_id,p_provincia_id,p_cliente_id,p_unidad_id,
    p_archivo_path,btrim(p_archivo_nombre),p_archivo_sha256,p_archivo_bytes,auth.uid(),'CORRECCION'
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

-- Storage: el gerente sube el PDF firmado a la MISMA ruta de versión que usan las correcciones
-- (coordinador_id/papeleta_id/vN.pdf), no una ruta propia, para no duplicar el esquema de
-- Storage. Solo si la papeleta está REGISTRADO (pendiente de firma) y él es gerente.
do $$ begin if to_regclass('storage.objects') is not null then
 execute $p$create policy papeletas_storage_insert_firma on storage.objects for insert to authenticated
  with check(bucket_id='papeletas-vacaciones' and private.es_gerente() and exists(
   select 1 from public.papeletas_vacaciones p
   where p.id::text=(storage.foldername(name))[2] and p.coordinador_id::text=(storage.foldername(name))[1]
     and p.estado='REGISTRADO'
  ))$p$;
 end if; end $$;

-- Borrado controlado de papeletas DE PRUEBA (arquitectura explícita, nunca inferida por nombre).
-- Mismo principio que private.admin_eliminar_requerimientos_prueba: flag de entorno (capa app,
-- ver lib/vacations/config.ts) + flag en private.app_config (capa BD) + solo admin + confirmación
-- fuerte en la UI + nunca FIRMADO + nunca por nombre, solo por es_prueba=true.
insert into private.app_config(clave,habilitado) values ('allow_test_papeleta_deletion',true)
  on conflict (clave) do nothing;

create function private.admin_marcar_papeleta_prueba(p_papeleta_id uuid,p_es_prueba boolean)
returns public.papeletas_vacaciones language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_doc public.papeletas_vacaciones;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  select * into v_doc from public.papeletas_vacaciones where id=p_papeleta_id for update;
  if not found then raise exception 'Papeleta no encontrada' using errcode='P0002'; end if;
  -- CONFORME (histórico, previo al flujo de firma real) recibe la misma protección que FIRMADO:
  -- ambos son estados terminales válidos y nunca deben poder marcarse como prueba ni eliminarse.
  if v_doc.estado in ('FIRMADO','CONFORME') then raise exception 'Una papeleta firmada o conforme no puede marcarse como prueba' using errcode='55000'; end if;
  update public.papeletas_vacaciones set es_prueba=coalesce(p_es_prueba,false) where id=p_papeleta_id returning * into v_doc;
  return v_doc;
end $$;
revoke all on function private.admin_marcar_papeleta_prueba(uuid,boolean) from public,anon,authenticated;
grant execute on function private.admin_marcar_papeleta_prueba(uuid,boolean) to authenticated;
create function public.admin_marcar_papeleta_prueba(p_papeleta_id uuid,p_es_prueba boolean) returns public.papeletas_vacaciones
language sql volatile security invoker set search_path=pg_catalog,pg_temp as $$
  select private.admin_marcar_papeleta_prueba(p_papeleta_id,p_es_prueba);
$$;
revoke all on function public.admin_marcar_papeleta_prueba(uuid,boolean) from public,anon,authenticated;
grant execute on function public.admin_marcar_papeleta_prueba(uuid,boolean) to authenticated;

-- Cola de limpieza de Storage pendiente. PostgreSQL y Supabase Storage NO comparten transacción:
-- el borrado en BD de abajo se confirma aquí mismo, pero el borrado físico de cada PDF ocurre
-- DESPUÉS, desde la capa de aplicación, y puede fallar (red, permisos, fallo parcial en un lote).
-- Esta tabla es la fuente de verdad de qué rutas TODAVÍA deben borrarse de Storage tras un
-- borrado de prueba ya confirmado en BD: se inserta en la MISMA transacción que borra las filas
-- (si la transacción no confirma, tampoco queda nada pendiente -- ver auditoría en el informe de
-- entrega), y una ruta solo se retira cuando la app confirma que Storage realmente la eliminó
-- (admin_confirmar_borrado_storage). Así ningún archivo huérfano queda silencioso: si Storage
-- falla total o parcialmente, la ruta sigue apareciendo aquí hasta reintentarse.
create table private.papeleta_storage_borrado_pendiente (
  archivo_path text primary key,
  papeleta_id uuid not null,
  creado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  intentos integer not null default 0,
  ultimo_intento_at timestamptz,
  ultimo_error text
);
revoke all on private.papeleta_storage_borrado_pendiente from public,anon,authenticated;

-- Elimina físicamente papeletas de prueba (es_prueba=true, nunca FIRMADO) y devuelve las rutas de
-- Storage de TODAS sus versiones, para que la capa de aplicación borre esos objetos sin dejar
-- huérfanos. No borra por nombre ni por antigüedad: solo lo que un admin marcó explícitamente.
-- Las mismas rutas quedan registradas en la cola de limpieza pendiente ANTES de confirmar esta
-- transacción, así que un fallo posterior de Storage nunca deja un huérfano sin rastro.
create function private.admin_eliminar_papeletas_prueba(p_ids uuid[])
returns text[] language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_count integer; v_unique integer; v_paths text[];
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Solo administradores' using errcode='42501'; end if;
  if not coalesce((select habilitado from private.app_config where clave='allow_test_papeleta_deletion'),false) then
    raise exception 'La eliminación de papeletas de prueba está deshabilitada' using errcode='55000'; end if;
  if p_ids is null or cardinality(p_ids)<1 or cardinality(p_ids)>100 or array_position(p_ids,null) is not null then
    raise exception 'Selecciona entre 1 y 100 papeletas' using errcode='22023'; end if;
  select count(distinct id) into v_unique from unnest(p_ids) id;
  if v_unique<>cardinality(p_ids) then raise exception 'No repitas papeletas' using errcode='22023'; end if;
  perform p.id from public.papeletas_vacaciones p where p.id=any(p_ids) order by p.id for update;
  get diagnostics v_count=row_count;
  if v_count<>v_unique then raise exception 'Una o más papeletas no existen' using errcode='P0002'; end if;
  if exists(select 1 from public.papeletas_vacaciones p where p.id=any(p_ids) and not p.es_prueba) then
    raise exception 'Solo se pueden eliminar papeletas marcadas como prueba' using errcode='55000'; end if;
  if exists(select 1 from public.papeletas_vacaciones p where p.id=any(p_ids) and p.estado in ('FIRMADO','CONFORME')) then
    raise exception 'Una papeleta firmada o conforme no puede eliminarse' using errcode='55000'; end if;

  select coalesce(array_agg(v.archivo_path),'{}') into v_paths
    from public.papeletas_vacaciones_versiones v where v.papeleta_id=any(p_ids);

  -- Se registra ANTES de borrar nada: si esta transacción no confirma (cualquier excepción
  -- posterior), la cola pendiente tampoco queda con nada, exactamente igual que las filas.
  insert into private.papeleta_storage_borrado_pendiente(archivo_path,papeleta_id,creado_por)
  select v.archivo_path,v.papeleta_id,auth.uid()
  from public.papeletas_vacaciones_versiones v where v.papeleta_id=any(p_ids)
  on conflict (archivo_path) do nothing;

  perform pg_catalog.set_config('app.test_papeleta_deletion','on',true);
  delete from public.papeletas_vacaciones_eventos where papeleta_id=any(p_ids);
  delete from public.papeletas_vacaciones_versiones where papeleta_id=any(p_ids);
  delete from public.papeletas_vacaciones where id=any(p_ids);
  perform pg_catalog.set_config('app.test_papeleta_deletion','off',true);
  return v_paths;
end $$;
revoke all on function private.admin_eliminar_papeletas_prueba(uuid[]) from public,anon,authenticated;
grant execute on function private.admin_eliminar_papeletas_prueba(uuid[]) to authenticated;
create function public.admin_eliminar_papeletas_prueba(p_ids uuid[]) returns text[]
language sql volatile security invoker set search_path=pg_catalog,pg_temp as $$
  select private.admin_eliminar_papeletas_prueba(p_ids);
$$;
revoke all on function public.admin_eliminar_papeletas_prueba(uuid[]) from public,anon,authenticated;
grant execute on function public.admin_eliminar_papeletas_prueba(uuid[]) to authenticated;

-- La app llama esto SOLO después de que Storage confirmó (sin error) que una ruta se eliminó.
-- Nunca se llama por adelantado: retirar una ruta de la cola antes de confirmarla realmente
-- borrada reintroduciría el riesgo de huérfano silencioso que esta cola existe para evitar.
create function private.admin_confirmar_borrado_storage(p_paths text[])
returns integer language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_count integer;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_paths is null or cardinality(p_paths)<1 then return 0; end if;
  delete from private.papeleta_storage_borrado_pendiente where archivo_path=any(p_paths);
  get diagnostics v_count=row_count;
  return v_count;
end $$;
revoke all on function private.admin_confirmar_borrado_storage(text[]) from public,anon,authenticated;
grant execute on function private.admin_confirmar_borrado_storage(text[]) to authenticated;
create function public.admin_confirmar_borrado_storage(p_paths text[]) returns integer
language sql volatile security invoker set search_path=pg_catalog,pg_temp as $$
  select private.admin_confirmar_borrado_storage(p_paths);
$$;
revoke all on function public.admin_confirmar_borrado_storage(text[]) from public,anon,authenticated;
grant execute on function public.admin_confirmar_borrado_storage(text[]) to authenticated;

-- Deja rastro explícito de un intento fallido (nunca falla en silencio): la ruta permanece en la
-- cola, pero queda visible cuántas veces se reintentó y cuál fue el último error.
create function private.admin_registrar_intento_borrado_storage(p_paths text[],p_error text)
returns void language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_paths is null or cardinality(p_paths)<1 then return; end if;
  update private.papeleta_storage_borrado_pendiente
    set intentos=intentos+1,ultimo_intento_at=now(),ultimo_error=left(coalesce(p_error,''),500)
  where archivo_path=any(p_paths);
end $$;
revoke all on function private.admin_registrar_intento_borrado_storage(text[],text) from public,anon,authenticated;
grant execute on function private.admin_registrar_intento_borrado_storage(text[],text) to authenticated;
create function public.admin_registrar_intento_borrado_storage(p_paths text[],p_error text) returns void
language sql volatile security invoker set search_path=pg_catalog,pg_temp as $$
  select private.admin_registrar_intento_borrado_storage(p_paths,p_error);
$$;
revoke all on function public.admin_registrar_intento_borrado_storage(text[],text) from public,anon,authenticated;
grant execute on function public.admin_registrar_intento_borrado_storage(text[],text) to authenticated;

-- Lista lo que sigue pendiente de borrar en Storage (para mostrarlo al admin y reintentar).
create function private.admin_listar_borrados_pendientes()
returns setof private.papeleta_storage_borrado_pendiente language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  return query select * from private.papeleta_storage_borrado_pendiente order by created_at;
end $$;
revoke all on function private.admin_listar_borrados_pendientes() from public,anon,authenticated;
grant execute on function private.admin_listar_borrados_pendientes() to authenticated;
create function public.admin_listar_borrados_pendientes() returns setof private.papeleta_storage_borrado_pendiente
language sql stable security invoker set search_path=pg_catalog,pg_temp as $$
  select * from private.admin_listar_borrados_pendientes();
$$;
revoke all on function public.admin_listar_borrados_pendientes() from public,anon,authenticated;
grant execute on function public.admin_listar_borrados_pendientes() to authenticated;

-- Fix de producción: la política de borrado huérfano de 202609190001 solo permite borrar a quien
-- sea DUEÑO de la carpeta (storage.foldername(name)[1]=auth.uid()), que es el coordinador, nunca
-- el admin. Sin esto, el admin.storage.remove() de la limpieza de pruebas fallaría siempre contra
-- RLS en producción. Esta política es aditiva y solo cubre objetos YA huérfanos (sin ninguna fila
-- que los referencie ni en la tabla principal ni en versiones): nunca borra un archivo vigente.
do $$ begin if to_regclass('storage.objects') is not null then
 execute $p$create policy papeletas_storage_delete_admin_huerfanos on storage.objects for delete to authenticated
  using(bucket_id='papeletas-vacaciones' and public.is_admin()
   and not exists(select 1 from public.papeletas_vacaciones p where p.archivo_path=name)
   and not exists(select 1 from public.papeletas_vacaciones_versiones v where v.archivo_path=name))$p$;
 end if; end $$;

notify pgrst,'reload schema';
commit;
