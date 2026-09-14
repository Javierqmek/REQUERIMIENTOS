-- Evidencia completa de cada acto de firma y descarga de la versión coordinador.
-- Ejecutar después de 202609140001_firma_coordinador.sql.
begin;

create or replace function public.confirmar_firma_coordinador(
 p_documento_id uuid,p_token uuid,p_path text,p_sha256 text
) returns void
language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare
 v_doc public.documentos;
 v_perfil public.perfiles_firma;
 v_role text;
begin
 select * into v_doc from public.documentos where id=p_documento_id for update;
 if not found then raise exception 'Documento no encontrado' using errcode='P0002'; end if;
 if auth.uid() is null or v_doc.usuario_creador_id<>auth.uid() or v_doc.estado not in ('BORRADOR','OBSERVADO')
  or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='coordinador')
  or v_doc.archivo_coordinador_path is not null or v_doc.firma_token is distinct from p_token
  or p_path not like 'coordinador/'||p_documento_id::text||'/%' or p_sha256!~'^[0-9a-f]{64}$'
  then raise exception 'Confirmación de coordinador no autorizada' using errcode='42501'; end if;
 select p.* into v_perfil from public.documento_firmas f
 join public.perfiles_firma p on p.id=f.perfil_firma_id
 where f.documento_id=p_documento_id and f.usuario_id=auth.uid()
 order by f.created_at,f.id limit 1;
 if not found or exists(
  select 1 from public.documento_firmas f where f.documento_id=p_documento_id
   and f.usuario_id=auth.uid() and f.perfil_firma_id<>v_perfil.id
 ) then raise exception 'Evidencia de perfil de firma inconsistente' using errcode='55000'; end if;
 select p.role::text into v_role from public.profiles p where p.id=auth.uid();
 update public.documentos set archivo_coordinador_path=p_path,archivo_coordinador_sha256=p_sha256,
  coordinador_firmado_at=clock_timestamp(),coordinador_firmante_id=auth.uid(),
  firma_token=null,firma_iniciada_at=null,updated_at=clock_timestamp()
 where id=p_documento_id;
 perform private.registrar_evento_documento(
  p_documento_id,'FIRMADO_COORDINADOR',v_doc.estado,v_doc.estado,null,
  jsonb_build_object(
   'usuario_id',auth.uid(),'nombre',v_perfil.nombre_mostrado,'rol',v_role,'cargo',v_perfil.cargo,
   'perfil_firma_id',v_perfil.id,'perfil_firma_version',v_perfil.version,
   'version_firmada','ORIGINAL','path_previo',v_doc.archivo_original_path,
   'sha256_previo',v_doc.archivo_original_sha256,'path_resultante',p_path,
   'sha256_resultante',p_sha256,'fecha_servidor',clock_timestamp()
  )
 );
end $$;
revoke all on function public.confirmar_firma_coordinador(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.confirmar_firma_coordinador(uuid,uuid,text,text) to authenticated;

create or replace function public.confirmar_firma_documento(
 p_documento_id uuid,p_token uuid,p_path text,p_sha256 text
) returns void
language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare
 v_doc public.documentos;
 v_perfil public.perfiles_firma;
 v_role text;
 v_version text;
 v_path_previo text;
 v_sha_previo text;
begin
 select * into v_doc from public.documentos where id=p_documento_id for update;
 if not found then raise exception 'Documento no encontrado' using errcode='P0002'; end if;
 if v_doc.firmante_id<>auth.uid() or v_doc.estado<>'PENDIENTE_FIRMA' or not private.es_gerente()
  or v_doc.firma_token is distinct from p_token
  or p_path not like 'firmado/'||p_documento_id::text||'/%' or p_sha256!~'^[0-9a-f]{64}$'
  then raise exception 'Confirmación no autorizada' using errcode='42501'; end if;
 select p.* into v_perfil from public.documento_firmas f
 join public.perfiles_firma p on p.id=f.perfil_firma_id
 where f.documento_id=p_documento_id and f.usuario_id=auth.uid()
 order by f.created_at,f.id limit 1;
 if not found or exists(
  select 1 from public.documento_firmas f where f.documento_id=p_documento_id
   and f.usuario_id=auth.uid() and f.perfil_firma_id<>v_perfil.id
 ) then raise exception 'Evidencia de perfil de firma inconsistente' using errcode='55000'; end if;
 select p.role::text into v_role from public.profiles p where p.id=auth.uid();
 if v_doc.archivo_coordinador_path is not null then
  v_version:='COORDINADOR';v_path_previo:=v_doc.archivo_coordinador_path;v_sha_previo:=v_doc.archivo_coordinador_sha256;
 else
  v_version:='ORIGINAL';v_path_previo:=v_doc.archivo_original_path;v_sha_previo:=v_doc.archivo_original_sha256;
 end if;
 update public.documentos set estado='FIRMADO',archivo_firmado_path=p_path,
  archivo_firmado_sha256=p_sha256,firmado_at=clock_timestamp(),firma_token=null,
  firma_iniciada_at=null,updated_at=clock_timestamp() where id=p_documento_id;
 perform private.registrar_evento_documento(
  p_documento_id,'FIRMADO','PENDIENTE_FIRMA','FIRMADO',null,
  jsonb_build_object(
   'usuario_id',auth.uid(),'nombre',v_perfil.nombre_mostrado,'rol',v_role,'cargo',v_perfil.cargo,
   'perfil_firma_id',v_perfil.id,'perfil_firma_version',v_perfil.version,
   'version_firmada',v_version,'path_previo',v_path_previo,'sha256_previo',v_sha_previo,
   'path_resultante',p_path,'sha256_resultante',p_sha256,'fecha_servidor',clock_timestamp()
  )
 );
end $$;
revoke all on function public.confirmar_firma_documento(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.confirmar_firma_documento(uuid,uuid,text,text) to authenticated;

create or replace function public.registrar_descarga_documento(p_documento_id uuid,p_tipo text)
returns void language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_doc public.documentos;
begin
 select * into v_doc from public.documentos where id=p_documento_id;
 if not found or not(v_doc.usuario_creador_id=auth.uid() or v_doc.firmante_id=auth.uid() or public.is_admin())
  then raise exception 'No autorizado' using errcode='42501'; end if;
 if p_tipo not in ('original','coordinador','firmado')
  then raise exception 'Tipo inválido' using errcode='22023'; end if;
 if p_tipo='coordinador' and v_doc.archivo_coordinador_path is null
  then raise exception 'Versión no disponible' using errcode='P0002'; end if;
 perform private.registrar_evento_documento(
  p_documento_id,'DESCARGADO',v_doc.estado,v_doc.estado,null,
  jsonb_build_object('tipo',p_tipo,'usuario_id',auth.uid(),'fecha_servidor',clock_timestamp())
 );
end $$;
revoke all on function public.registrar_descarga_documento(uuid,text) from public,anon,authenticated;
grant execute on function public.registrar_descarga_documento(uuid,text) to authenticated;

comment on function public.confirmar_firma_coordinador(uuid,uuid,text,text) is
 'Confirma versión intermedia y conserva evidencia del perfil versionado y hashes previo/resultante.';
comment on function public.confirmar_firma_documento(uuid,uuid,text,text) is
 'Confirma versión final y conserva evidencia del perfil versionado, versión base y hashes previo/resultante.';

notify pgrst,'reload schema';
commit;
