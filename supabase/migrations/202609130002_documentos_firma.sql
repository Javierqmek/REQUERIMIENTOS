-- Gestión documental y firma electrónica interna.
-- Ejecutar después de 202609130001_admin_catalogos_crud.sql.
alter type public.user_role add value if not exists 'gerente';
begin;
create type public.documento_tipo as enum ('VACACIONES','LICENCIA_CON_GOCE','LICENCIA_SIN_GOCE');
create type public.documento_estado as enum ('BORRADOR','PENDIENTE_FIRMA','OBSERVADO','FIRMADO','RECHAZADO');
create type public.elemento_firma as enum ('FIRMA','SELLO');

create table public.perfiles_firma (
 id uuid primary key default gen_random_uuid(), usuario_id uuid not null references public.profiles(id),
 version integer not null check(version>0), nombre_mostrado text not null check(char_length(nombre_mostrado) between 2 and 160),
 cargo text not null check(char_length(cargo) between 2 and 120), firma_path text,
 firma_sha256 text check(firma_sha256 is null or firma_sha256~'^[0-9a-f]{64}$'),
 sello_path text not null, sello_sha256 text not null check(sello_sha256~'^[0-9a-f]{64}$'),
 activo boolean not null default true, created_at timestamptz not null default now(),
 unique(usuario_id,version), check((firma_path is null)=(firma_sha256 is null))
);
create unique index perfiles_firma_usuario_activo_uidx on public.perfiles_firma(usuario_id) where activo;
create table public.documentos (
 id uuid primary key, tipo public.documento_tipo not null, trabajador_id uuid not null references public.personal(id),
 usuario_creador_id uuid not null references public.profiles(id), firmante_id uuid not null references public.profiles(id),
 estado public.documento_estado not null default 'BORRADOR',
 observacion text check(observacion is null or char_length(observacion)<=1000),
 comentario_decision text check(comentario_decision is null or char_length(comentario_decision)<=1000),
 archivo_original_path text not null unique, archivo_original_nombre text not null check(char_length(archivo_original_nombre) between 1 and 180),
 archivo_original_sha256 text not null check(archivo_original_sha256~'^[0-9a-f]{64}$'),
 archivo_original_bytes integer not null check(archivo_original_bytes between 1 and 20971520),
 paginas integer not null check(paginas between 1 and 500), archivo_firmado_path text unique,
 archivo_firmado_sha256 text check(archivo_firmado_sha256 is null or archivo_firmado_sha256~'^[0-9a-f]{64}$'),
 firma_token uuid, firma_iniciada_at timestamptz, enviado_at timestamptz, firmado_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check((estado='FIRMADO')=(archivo_firmado_path is not null and archivo_firmado_sha256 is not null and firmado_at is not null))
);
create table public.documento_firmas (
 id uuid primary key default gen_random_uuid(), documento_id uuid not null references public.documentos(id),
 usuario_id uuid not null references public.profiles(id), perfil_firma_id uuid not null references public.perfiles_firma(id),
 tipo public.elemento_firma not null, pagina integer not null check(pagina>0),
 x numeric(8,7) not null check(x>=0 and x<=1), y numeric(8,7) not null check(y>=0 and y<=1),
 ancho numeric(8,7) not null check(ancho>0 and ancho<=1), alto numeric(8,7) not null check(alto>0 and alto<=1),
 asset_path text not null, asset_sha256 text not null check(asset_sha256~'^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(), check(x+ancho<=1.0000001 and y+alto<=1.0000001)
);
create table public.documento_eventos (
 id bigint generated always as identity primary key, documento_id uuid not null references public.documentos(id),
 usuario_id uuid not null references public.profiles(id),
 accion text not null check(accion in ('CREADO','COLOCACIONES_ACTUALIZADAS','ENVIADO','OBSERVADO','RECHAZADO','FIRMADO','DESCARGADO')),
 estado_anterior public.documento_estado, estado_nuevo public.documento_estado,
 comentario text check(comentario is null or char_length(comentario)<=1000), metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index documentos_creador_fecha_idx on public.documentos(usuario_creador_id,created_at desc);
create index documentos_firmante_estado_fecha_idx on public.documentos(firmante_id,estado,created_at desc);
create index documentos_trabajador_idx on public.documentos(trabajador_id);
create index documento_firmas_documento_idx on public.documento_firmas(documento_id,pagina);
create index documento_eventos_documento_fecha_idx on public.documento_eventos(documento_id,created_at desc);

alter table public.perfiles_firma enable row level security; alter table public.documentos enable row level security;
alter table public.documento_firmas enable row level security; alter table public.documento_eventos enable row level security;
alter table public.perfiles_firma force row level security; alter table public.documentos force row level security;
alter table public.documento_firmas force row level security; alter table public.documento_eventos force row level security;
create policy perfiles_firma_lectura on public.perfiles_firma for select to authenticated using(usuario_id=auth.uid() or public.is_admin());
create policy documentos_lectura on public.documentos for select to authenticated using(usuario_creador_id=auth.uid() or firmante_id=auth.uid() or public.is_admin());
create policy documento_firmas_lectura on public.documento_firmas for select to authenticated using(exists(select 1 from public.documentos d where d.id=documento_id));
create policy documento_eventos_lectura on public.documento_eventos for select to authenticated using(exists(select 1 from public.documentos d where d.id=documento_id));
create policy perfiles_gerentes_lectura on public.profiles for select to authenticated using(role='gerente');
revoke all on public.perfiles_firma,public.documentos,public.documento_firmas,public.documento_eventos from public,anon,authenticated;
grant select on public.perfiles_firma,public.documentos,public.documento_firmas,public.documento_eventos to authenticated;
revoke all on sequence public.documento_eventos_id_seq from public,anon,authenticated;

create function private.es_gerente() returns boolean language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and role='gerente') $$;
revoke all on function private.es_gerente() from public,anon,authenticated; grant execute on function private.es_gerente() to authenticated;
create function private.registrar_evento_documento(p_documento_id uuid,p_accion text,p_anterior public.documento_estado,p_nuevo public.documento_estado,p_comentario text default null,p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$ begin
 insert into public.documento_eventos(documento_id,usuario_id,accion,estado_anterior,estado_nuevo,comentario,metadata)
 values(p_documento_id,auth.uid(),p_accion,p_anterior,p_nuevo,nullif(btrim(p_comentario),''),coalesce(p_metadata,'{}'::jsonb)); end $$;
revoke all on function private.registrar_evento_documento(uuid,text,public.documento_estado,public.documento_estado,text,jsonb) from public,anon,authenticated;

create function public.listar_gerentes_firma() returns table(id uuid,nombre text) language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
 select p.id,p.nombre from public.profiles p where auth.uid() is not null and p.role='gerente' order by p.nombre $$;
revoke all on function public.listar_gerentes_firma() from public,anon,authenticated; grant execute on function public.listar_gerentes_firma() to authenticated;
create function public.guardar_perfil_firma(p_nombre text,p_cargo text,p_firma_path text,p_firma_sha256 text,p_sello_path text,p_sello_sha256 text)
returns public.perfiles_firma language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_version integer; v_result public.perfiles_firma; v_role public.user_role; begin
 select role into v_role from public.profiles where id=auth.uid();
 if v_role is null or v_role not in ('coordinador','gerente') then raise exception 'Rol no autorizado' using errcode='42501'; end if;
 if char_length(btrim(p_nombre)) not between 2 and 160 or char_length(btrim(p_cargo)) not between 2 and 120 or p_sello_path is null
  or p_sello_sha256!~'^[0-9a-f]{64}$' or ((p_firma_path is null)<>(p_firma_sha256 is null))
  or (p_firma_sha256 is not null and p_firma_sha256!~'^[0-9a-f]{64}$') then raise exception 'Perfil de firma inválido' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('perfil-firma:'||auth.uid()::text,0));
 select coalesce(max(version),0)+1 into v_version from public.perfiles_firma where usuario_id=auth.uid();
 update public.perfiles_firma set activo=false where usuario_id=auth.uid() and activo;
 insert into public.perfiles_firma(usuario_id,version,nombre_mostrado,cargo,firma_path,firma_sha256,sello_path,sello_sha256)
 values(auth.uid(),v_version,btrim(p_nombre),btrim(p_cargo),p_firma_path,p_firma_sha256,p_sello_path,p_sello_sha256) returning * into v_result;
 return v_result; end $$;
revoke all on function public.guardar_perfil_firma(text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.guardar_perfil_firma(text,text,text,text,text,text) to authenticated;

create function public.registrar_documento(p_id uuid,p_tipo public.documento_tipo,p_trabajador_id uuid,p_firmante_id uuid,p_observacion text,p_path text,p_nombre text,p_sha256 text,p_bytes integer,p_paginas integer)
returns uuid language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$ begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role='coordinador') then raise exception 'Solo coordinadores pueden crear documentos' using errcode='42501'; end if;
 if p_id is null or not exists(select 1 from public.personal where id=p_trabajador_id and activo)
  or not exists(select 1 from public.profiles where id=p_firmante_id and role='gerente')
  or p_path<>'original/'||auth.uid()::text||'/'||p_id::text||'.pdf' or p_sha256!~'^[0-9a-f]{64}$'
  or p_bytes not between 1 and 20971520 or p_paginas not between 1 and 500 or char_length(btrim(p_nombre)) not between 1 and 180
  or char_length(coalesce(p_observacion,''))>1000 then raise exception 'Documento inválido' using errcode='22023'; end if;
 insert into public.documentos(id,tipo,trabajador_id,usuario_creador_id,firmante_id,observacion,archivo_original_path,archivo_original_nombre,archivo_original_sha256,archivo_original_bytes,paginas)
 values(p_id,p_tipo,p_trabajador_id,auth.uid(),p_firmante_id,nullif(btrim(p_observacion),''),p_path,btrim(p_nombre),p_sha256,p_bytes,p_paginas);
 perform private.registrar_evento_documento(p_id,'CREADO',null,'BORRADOR',null,jsonb_build_object('sha256',p_sha256)); return p_id; end $$;
revoke all on function public.registrar_documento(uuid,public.documento_tipo,uuid,uuid,text,text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.registrar_documento(uuid,public.documento_tipo,uuid,uuid,text,text,text,text,integer,integer) to authenticated;

create function public.guardar_colocaciones_documento(p_documento_id uuid,p_colocaciones jsonb)
returns integer language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_doc public.documentos; v_perfil public.perfiles_firma; v_item jsonb; v_count integer:=0; v_tipo public.elemento_firma;
 v_pagina integer; v_x numeric; v_y numeric; v_ancho numeric; v_alto numeric; begin
 select * into v_doc from public.documentos where id=p_documento_id for update;
 if not found then raise exception 'Documento no encontrado' using errcode='P0002'; end if;
 if not ((v_doc.usuario_creador_id=auth.uid() and v_doc.estado in ('BORRADOR','OBSERVADO')) or
  (v_doc.firmante_id=auth.uid() and v_doc.estado='PENDIENTE_FIRMA' and private.es_gerente())) then raise exception 'No autorizado para colocar firma' using errcode='42501'; end if;
 if jsonb_typeof(p_colocaciones)<>'array' or jsonb_array_length(p_colocaciones)>20 then raise exception 'Colocaciones inválidas' using errcode='22023'; end if;
 select * into v_perfil from public.perfiles_firma where usuario_id=auth.uid() and activo for share;
 if not found then raise exception 'Configura primero tu firma y sello' using errcode='55000'; end if;
 delete from public.documento_firmas where documento_id=p_documento_id and usuario_id=auth.uid();
 for v_item in select value from jsonb_array_elements(p_colocaciones) loop
  begin v_tipo:=(v_item->>'tipo')::public.elemento_firma; v_pagina:=(v_item->>'pagina')::integer; v_x:=(v_item->>'x')::numeric;
   v_y:=(v_item->>'y')::numeric; v_ancho:=(v_item->>'ancho')::numeric; v_alto:=(v_item->>'alto')::numeric;
  exception when others then raise exception 'Coordenadas inválidas' using errcode='22023'; end;
  if (v_item-'tipo'-'pagina'-'x'-'y'-'ancho'-'alto')<>'{}'::jsonb or v_pagina not between 1 and v_doc.paginas
   or v_x<0 or v_y<0 or v_ancho<=0 or v_alto<=0 or v_x+v_ancho>1 or v_y+v_alto>1 or (v_tipo='FIRMA' and v_perfil.firma_path is null)
   then raise exception 'Colocación fuera del documento' using errcode='22023'; end if;
  insert into public.documento_firmas(documento_id,usuario_id,perfil_firma_id,tipo,pagina,x,y,ancho,alto,asset_path,asset_sha256)
  values(p_documento_id,auth.uid(),v_perfil.id,v_tipo,v_pagina,v_x,v_y,v_ancho,v_alto,
   case when v_tipo='FIRMA' then v_perfil.firma_path else v_perfil.sello_path end,
   case when v_tipo='FIRMA' then v_perfil.firma_sha256 else v_perfil.sello_sha256 end); v_count:=v_count+1;
 end loop;
 perform private.registrar_evento_documento(p_documento_id,'COLOCACIONES_ACTUALIZADAS',v_doc.estado,v_doc.estado,null,jsonb_build_object('cantidad',v_count));
 return v_count; end $$;
revoke all on function public.guardar_colocaciones_documento(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.guardar_colocaciones_documento(uuid,jsonb) to authenticated;

create function public.enviar_documento_firma(p_documento_id uuid) returns void language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_doc public.documentos; begin select * into v_doc from public.documentos where id=p_documento_id for update;
 if not found then raise exception 'Documento no encontrado' using errcode='P0002'; end if;
 if v_doc.usuario_creador_id<>auth.uid() or v_doc.estado not in ('BORRADOR','OBSERVADO') then raise exception 'No autorizado' using errcode='42501'; end if;
 update public.documentos set estado='PENDIENTE_FIRMA',comentario_decision=null,enviado_at=now(),updated_at=now() where id=p_documento_id;
 perform private.registrar_evento_documento(p_documento_id,'ENVIADO',v_doc.estado,'PENDIENTE_FIRMA'); end $$;
revoke all on function public.enviar_documento_firma(uuid) from public,anon,authenticated; grant execute on function public.enviar_documento_firma(uuid) to authenticated;
create function public.decidir_documento(p_documento_id uuid,p_decision text,p_comentario text) returns void language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_doc public.documentos; v_nuevo public.documento_estado; v_accion text; begin select * into v_doc from public.documentos where id=p_documento_id for update;
 if not found then raise exception 'Documento no encontrado' using errcode='P0002'; end if;
 if v_doc.firmante_id<>auth.uid() or v_doc.estado<>'PENDIENTE_FIRMA' or not private.es_gerente() then raise exception 'No autorizado' using errcode='42501'; end if;
 if p_decision='OBSERVAR' then v_nuevo:='OBSERVADO';v_accion:='OBSERVADO'; elsif p_decision='RECHAZAR' then v_nuevo:='RECHAZADO';v_accion:='RECHAZADO';
 else raise exception 'Decisión inválida' using errcode='22023'; end if;
 if nullif(btrim(p_comentario),'') is null or char_length(btrim(p_comentario))>1000 then raise exception 'Comentario obligatorio' using errcode='22023'; end if;
 update public.documentos set estado=v_nuevo,comentario_decision=btrim(p_comentario),firma_token=null,firma_iniciada_at=null,updated_at=now() where id=p_documento_id;
 perform private.registrar_evento_documento(p_documento_id,v_accion,'PENDIENTE_FIRMA',v_nuevo,p_comentario); end $$;
revoke all on function public.decidir_documento(uuid,text,text) from public,anon,authenticated; grant execute on function public.decidir_documento(uuid,text,text) to authenticated;

create function public.preparar_firma_documento(p_documento_id uuid) returns uuid language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_doc public.documentos; v_token uuid:=gen_random_uuid(); begin select * into v_doc from public.documentos where id=p_documento_id for update;
 if not found then raise exception 'Documento no encontrado' using errcode='P0002'; end if;
 if v_doc.firmante_id<>auth.uid() or v_doc.estado<>'PENDIENTE_FIRMA' or not private.es_gerente() then raise exception 'No autorizado' using errcode='42501'; end if;
 if v_doc.firma_token is not null and v_doc.firma_iniciada_at>now()-interval '5 minutes' then raise exception 'Firma en proceso' using errcode='55000'; end if;
 if not exists(select 1 from public.documento_firmas where documento_id=p_documento_id and usuario_id=auth.uid()) then raise exception 'Coloca tu firma o sello antes de firmar' using errcode='55000'; end if;
 update public.documentos set firma_token=v_token,firma_iniciada_at=now(),updated_at=now() where id=p_documento_id; return v_token; end $$;
revoke all on function public.preparar_firma_documento(uuid) from public,anon,authenticated; grant execute on function public.preparar_firma_documento(uuid) to authenticated;
create function public.cancelar_preparacion_firma(p_documento_id uuid,p_token uuid) returns void language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
begin update public.documentos set firma_token=null,firma_iniciada_at=null,updated_at=now() where id=p_documento_id and firmante_id=auth.uid() and estado='PENDIENTE_FIRMA' and firma_token=p_token; end $$;
revoke all on function public.cancelar_preparacion_firma(uuid,uuid) from public,anon,authenticated; grant execute on function public.cancelar_preparacion_firma(uuid,uuid) to authenticated;
create function public.confirmar_firma_documento(p_documento_id uuid,p_token uuid,p_path text,p_sha256 text) returns void language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_doc public.documentos; begin select * into v_doc from public.documentos where id=p_documento_id for update;
 if not found then raise exception 'Documento no encontrado' using errcode='P0002'; end if;
 if v_doc.firmante_id<>auth.uid() or v_doc.estado<>'PENDIENTE_FIRMA' or not private.es_gerente() or v_doc.firma_token is distinct from p_token
  or p_path not like 'firmado/'||p_documento_id::text||'/%' or p_sha256!~'^[0-9a-f]{64}$' then raise exception 'Confirmación no autorizada' using errcode='42501'; end if;
 update public.documentos set estado='FIRMADO',archivo_firmado_path=p_path,archivo_firmado_sha256=p_sha256,firmado_at=now(),firma_token=null,firma_iniciada_at=null,updated_at=now() where id=p_documento_id;
 perform private.registrar_evento_documento(p_documento_id,'FIRMADO','PENDIENTE_FIRMA','FIRMADO',null,jsonb_build_object('sha256',p_sha256)); end $$;
revoke all on function public.confirmar_firma_documento(uuid,uuid,text,text) from public,anon,authenticated; grant execute on function public.confirmar_firma_documento(uuid,uuid,text,text) to authenticated;
create function public.registrar_descarga_documento(p_documento_id uuid,p_tipo text) returns void language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_doc public.documentos; begin select * into v_doc from public.documentos where id=p_documento_id;
 if not found or not(v_doc.usuario_creador_id=auth.uid() or v_doc.firmante_id=auth.uid() or public.is_admin()) then raise exception 'No autorizado' using errcode='42501'; end if;
 if p_tipo not in ('original','firmado') then raise exception 'Tipo inválido' using errcode='22023'; end if;
 perform private.registrar_evento_documento(p_documento_id,'DESCARGADO',v_doc.estado,v_doc.estado,null,jsonb_build_object('tipo',p_tipo)); end $$;
revoke all on function public.registrar_descarga_documento(uuid,text) from public,anon,authenticated; grant execute on function public.registrar_descarga_documento(uuid,text) to authenticated;

create function public.admin_desactivar_perfil_firma(p_usuario_id uuid) returns void language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
 update public.perfiles_firma set activo=false where usuario_id=p_usuario_id and activo;
end $$;
revoke all on function public.admin_desactivar_perfil_firma(uuid) from public,anon,authenticated;
grant execute on function public.admin_desactivar_perfil_firma(uuid) to authenticated;

do $$ begin if to_regclass('storage.buckets') is not null then
 insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('documentos-firma','documentos-firma',false,20971520,array['application/pdf','image/png','image/webp'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types; end if; end $$;
do $$ begin if to_regclass('storage.objects') is not null then
 execute $p$create policy documentos_firma_insert on storage.objects for insert to authenticated with check(bucket_id='documentos-firma' and (
  ((storage.foldername(name))[1]='original' and (storage.foldername(name))[2]=auth.uid()::text)
  or ((storage.foldername(name))[1] in ('firmas','sellos') and (storage.foldername(name))[2]=auth.uid()::text)
  or ((storage.foldername(name))[1]='firmado' and exists(select 1 from public.documentos d where d.id=((storage.foldername(name))[2])::uuid and d.firmante_id=auth.uid() and d.estado='PENDIENTE_FIRMA'))))$p$;
 execute $p$create policy documentos_firma_select on storage.objects for select to authenticated using(bucket_id='documentos-firma' and (
  (((storage.foldername(name))[1] in ('firmas','sellos')) and ((storage.foldername(name))[2]=auth.uid()::text or public.is_admin()))
  or exists(select 1 from public.documentos d where (d.archivo_original_path=name or d.archivo_firmado_path=name) and (d.usuario_creador_id=auth.uid() or d.firmante_id=auth.uid() or public.is_admin()))
  or exists(select 1 from public.documento_firmas f join public.documentos d on d.id=f.documento_id where f.asset_path=name and (d.usuario_creador_id=auth.uid() or d.firmante_id=auth.uid() or public.is_admin()))))$p$;
 execute $p$create policy documentos_firma_delete_huerfanos on storage.objects for delete to authenticated using(bucket_id='documentos-firma' and (storage.foldername(name))[1]='original'
  and (storage.foldername(name))[2]=auth.uid()::text and not exists(select 1 from public.documentos d where d.archivo_original_path=name))$p$;
 end if; end $$;
notify pgrst,'reload schema';
commit;
