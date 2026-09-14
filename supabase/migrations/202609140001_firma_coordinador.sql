-- Firma opcional e intermedia del coordinador.
-- Ejecutar después de 202609130002_documentos_firma.sql.
begin;

alter table public.documentos
 add column archivo_coordinador_path text unique,
 add column archivo_coordinador_sha256 text,
 add column coordinador_firmado_at timestamptz,
 add column coordinador_firmante_id uuid references public.profiles(id);

alter table public.documentos
 add constraint documentos_version_coordinador_completa_check check (
  (archivo_coordinador_path is null and archivo_coordinador_sha256 is null and coordinador_firmado_at is null and coordinador_firmante_id is null)
  or
  (archivo_coordinador_path is not null and archivo_coordinador_sha256~'^[0-9a-f]{64}$' and coordinador_firmado_at is not null and coordinador_firmante_id=usuario_creador_id)
 );

alter table public.documento_eventos drop constraint if exists documento_eventos_accion_check;
alter table public.documento_eventos add constraint documento_eventos_accion_check
 check(accion in ('CREADO','COLOCACIONES_ACTUALIZADAS','FIRMADO_COORDINADOR','ENVIADO','OBSERVADO','RECHAZADO','FIRMADO','DESCARGADO'));

create function private.proteger_version_coordinador() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 if old.archivo_coordinador_path is not null and (
  new.archivo_coordinador_path is distinct from old.archivo_coordinador_path
  or new.archivo_coordinador_sha256 is distinct from old.archivo_coordinador_sha256
  or new.coordinador_firmado_at is distinct from old.coordinador_firmado_at
  or new.coordinador_firmante_id is distinct from old.coordinador_firmante_id
 ) then raise exception 'La versión firmada por el coordinador es inmutable' using errcode='55000'; end if;
 return new;
end $$;
revoke all on function private.proteger_version_coordinador() from public,anon,authenticated;
create trigger proteger_version_coordinador before update on public.documentos
 for each row execute function private.proteger_version_coordinador();

create function private.proteger_colocaciones_coordinador_firmadas() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare
 v_usuario uuid:=case when tg_op='DELETE' then old.usuario_id else new.usuario_id end;
 v_bloqueado boolean;
begin
 select d.archivo_coordinador_path is not null and d.usuario_creador_id=v_usuario
 into v_bloqueado from public.documentos d where d.id=case when tg_op='DELETE' then old.documento_id else new.documento_id end;
 if coalesce(v_bloqueado,false) then raise exception 'La firma del coordinador ya fue incorporada' using errcode='55000'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.proteger_colocaciones_coordinador_firmadas() from public,anon,authenticated;
create trigger proteger_colocaciones_coordinador_firmadas
 before insert or update or delete on public.documento_firmas
 for each row execute function private.proteger_colocaciones_coordinador_firmadas();

create function public.preparar_firma_coordinador(p_documento_id uuid) returns uuid
language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_doc public.documentos; v_token uuid:=gen_random_uuid();
begin
 select * into v_doc from public.documentos where id=p_documento_id for update;
 if not found then raise exception 'Documento no encontrado' using errcode='P0002'; end if;
 if auth.uid() is null or v_doc.usuario_creador_id<>auth.uid() or v_doc.estado not in ('BORRADOR','OBSERVADO')
  or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='coordinador')
  then raise exception 'Solo el coordinador creador puede firmar esta versión' using errcode='42501'; end if;
 if v_doc.archivo_coordinador_path is not null then raise exception 'El coordinador ya firmó este documento' using errcode='55000'; end if;
 if v_doc.firma_token is not null and v_doc.firma_iniciada_at>now()-interval '5 minutes'
  then raise exception 'Firma en proceso' using errcode='55000'; end if;
 if not exists(select 1 from public.documento_firmas f where f.documento_id=p_documento_id and f.usuario_id=auth.uid())
  then raise exception 'Coloca tu firma o sello antes de firmar' using errcode='55000'; end if;
 update public.documentos set firma_token=v_token,firma_iniciada_at=now(),updated_at=now() where id=p_documento_id;
 return v_token;
end $$;
revoke all on function public.preparar_firma_coordinador(uuid) from public,anon,authenticated;
grant execute on function public.preparar_firma_coordinador(uuid) to authenticated;

create function public.cancelar_preparacion_firma_coordinador(p_documento_id uuid,p_token uuid) returns void
language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 update public.documentos set firma_token=null,firma_iniciada_at=null,updated_at=now()
 where id=p_documento_id and usuario_creador_id=auth.uid() and estado in ('BORRADOR','OBSERVADO')
  and archivo_coordinador_path is null and firma_token=p_token;
end $$;
revoke all on function public.cancelar_preparacion_firma_coordinador(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cancelar_preparacion_firma_coordinador(uuid,uuid) to authenticated;

create function public.confirmar_firma_coordinador(p_documento_id uuid,p_token uuid,p_path text,p_sha256 text) returns void
language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_doc public.documentos;
begin
 select * into v_doc from public.documentos where id=p_documento_id for update;
 if not found then raise exception 'Documento no encontrado' using errcode='P0002'; end if;
 if auth.uid() is null or v_doc.usuario_creador_id<>auth.uid() or v_doc.estado not in ('BORRADOR','OBSERVADO')
  or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='coordinador')
  or v_doc.archivo_coordinador_path is not null or v_doc.firma_token is distinct from p_token
  or p_path not like 'coordinador/'||p_documento_id::text||'/%' or p_sha256!~'^[0-9a-f]{64}$'
  then raise exception 'Confirmación de coordinador no autorizada' using errcode='42501'; end if;
 update public.documentos set archivo_coordinador_path=p_path,archivo_coordinador_sha256=p_sha256,
  coordinador_firmado_at=now(),coordinador_firmante_id=auth.uid(),firma_token=null,firma_iniciada_at=null,updated_at=now()
 where id=p_documento_id;
 perform private.registrar_evento_documento(p_documento_id,'FIRMADO_COORDINADOR',v_doc.estado,v_doc.estado,null,jsonb_build_object('sha256',p_sha256));
end $$;
revoke all on function public.confirmar_firma_coordinador(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.confirmar_firma_coordinador(uuid,uuid,text,text) to authenticated;

create or replace function public.enviar_documento_firma(p_documento_id uuid) returns void
language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_doc public.documentos;
begin
 select * into v_doc from public.documentos where id=p_documento_id for update;
 if not found then raise exception 'Documento no encontrado' using errcode='P0002'; end if;
 if v_doc.usuario_creador_id<>auth.uid() or v_doc.estado not in ('BORRADOR','OBSERVADO')
  then raise exception 'No autorizado' using errcode='42501'; end if;
 if v_doc.firma_token is not null and v_doc.firma_iniciada_at>now()-interval '5 minutes'
  then raise exception 'Firma en proceso' using errcode='55000'; end if;
 update public.documentos set estado='PENDIENTE_FIRMA',comentario_decision=null,enviado_at=now(),
  firma_token=null,firma_iniciada_at=null,updated_at=now() where id=p_documento_id;
 perform private.registrar_evento_documento(p_documento_id,'ENVIADO',v_doc.estado,'PENDIENTE_FIRMA');
end $$;
revoke all on function public.enviar_documento_firma(uuid) from public,anon,authenticated;
grant execute on function public.enviar_documento_firma(uuid) to authenticated;

do $$ begin if to_regclass('storage.objects') is not null then
 execute 'drop policy if exists documentos_firma_insert on storage.objects';
 execute $p$create policy documentos_firma_insert on storage.objects for insert to authenticated with check(bucket_id='documentos-firma' and (
  ((storage.foldername(name))[1]='original' and (storage.foldername(name))[2]=auth.uid()::text)
  or ((storage.foldername(name))[1] in ('firmas','sellos') and (storage.foldername(name))[2]=auth.uid()::text)
  or ((storage.foldername(name))[1]='coordinador' and exists(select 1 from public.documentos d where d.id=((storage.foldername(name))[2])::uuid and d.usuario_creador_id=auth.uid() and d.estado in ('BORRADOR','OBSERVADO') and d.archivo_coordinador_path is null))
  or ((storage.foldername(name))[1]='firmado' and exists(select 1 from public.documentos d where d.id=((storage.foldername(name))[2])::uuid and d.firmante_id=auth.uid() and d.estado='PENDIENTE_FIRMA'))))$p$;
 execute 'drop policy if exists documentos_firma_select on storage.objects';
 execute $p$create policy documentos_firma_select on storage.objects for select to authenticated using(bucket_id='documentos-firma' and (
  (((storage.foldername(name))[1] in ('firmas','sellos')) and ((storage.foldername(name))[2]=auth.uid()::text or public.is_admin()))
  or exists(select 1 from public.documentos d where (d.archivo_original_path=name or d.archivo_coordinador_path=name or d.archivo_firmado_path=name) and (d.usuario_creador_id=auth.uid() or d.firmante_id=auth.uid() or public.is_admin()))
  or exists(select 1 from public.documento_firmas f join public.documentos d on d.id=f.documento_id where f.asset_path=name and (d.usuario_creador_id=auth.uid() or d.firmante_id=auth.uid() or public.is_admin()))))$p$;
 execute 'drop policy if exists documentos_firma_delete_huerfanos on storage.objects';
 execute $p$create policy documentos_firma_delete_huerfanos on storage.objects for delete to authenticated using(bucket_id='documentos-firma' and (
  ((storage.foldername(name))[1]='original' and (storage.foldername(name))[2]=auth.uid()::text and not exists(select 1 from public.documentos d where d.archivo_original_path=name))
  or ((storage.foldername(name))[1]='coordinador' and exists(select 1 from public.documentos d where d.id=((storage.foldername(name))[2])::uuid and d.usuario_creador_id=auth.uid() and d.archivo_coordinador_path is distinct from name))
  or ((storage.foldername(name))[1]='firmado' and exists(select 1 from public.documentos d where d.id=((storage.foldername(name))[2])::uuid and d.firmante_id=auth.uid() and d.archivo_firmado_path is distinct from name))))$p$;
 end if; end $$;

notify pgrst,'reload schema';
commit;
