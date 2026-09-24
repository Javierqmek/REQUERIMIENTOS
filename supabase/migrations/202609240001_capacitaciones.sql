-- Módulo de Capacitaciones: agentes con login propio, video + material, examen obligatorio
-- post-video (bloqueado hasta ver un % mínimo), asignación por cliente o global, y reportes.
-- No modifica ninguna migración anterior. Usa los roles 'agente' y 'capacitador' agregados por
-- 202609240000_roles_capacitaciones.sql -- esa migración DEBE estar aplicada (con commit) antes
-- que esta, porque un valor de enum recién agregado no puede usarse en la misma transacción que
-- lo agregó (error 55P04). Ambos roles quedan FUERA de la whitelist de roles de lib/auth.ts
-- (admin/coordinador/gerente): tienen su propio layout/guard en app/capacitaciones, así que
-- ningún código existente del módulo de Requerimientos/Vacaciones cambia de comportamiento.

begin;

-- Vínculo agente ↔ cuenta de acceso. personal.id sigue siendo el mismo que ya usan
-- requerimientos/papeletas (no se toca su PK ni sus FKs existentes). profile_id se completa
-- SOLO cuando el agente se autoregistra validando su DNI + código; nunca antes.
-- cliente_actual_id es un campo NUEVO y explícito para targeting de capacitaciones -- distinto
-- del campo legado personal.cliente (texto libre, "no usar", ver 202609020001).
alter table public.personal
  add column email text,
  add column profile_id uuid unique references public.profiles(id),
  add column cliente_actual_id uuid references public.clientes(id);
create unique index personal_email_uidx on public.personal (lower(email)) where email is not null;

create function private.es_capacitador() returns boolean language sql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='capacitador');
$$;
revoke all on function private.es_capacitador() from public,anon,authenticated;
grant execute on function private.es_capacitador() to authenticated;
create function private.es_agente() returns boolean language sql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='agente');
$$;
revoke all on function private.es_agente() from public,anon,authenticated;
grant execute on function private.es_agente() to authenticated;

-- ============================================================================
-- Autoregistro del agente (capa BD): validación estricta contra rate limit + coincidencia
-- exacta DNI + código, y solo si esa fila de personal todavía no tiene cuenta. La creación real
-- del usuario de Auth ocurre en la API (requiere la Admin API de Supabase, service role, no se
-- puede hacer desde SQL) -- esta función SOLO valida y, tras crear el usuario, vincula.
-- Se llama con service role desde el servidor (nunca desde el navegador), así que no necesita
-- estar expuesta a "anon": la ruta /api/capacitaciones/registro es la única que la invoca.
-- ============================================================================
create table private.registro_agente_intentos (
  clave text not null,
  intentado_at timestamptz not null default now()
);
revoke all on private.registro_agente_intentos from public,anon,authenticated;
create index registro_agente_intentos_clave_idx on private.registro_agente_intentos(clave, intentado_at desc);

create function private.registrar_intento_registro(p_clave text) returns integer
language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_count integer;
begin
  delete from private.registro_agente_intentos where intentado_at < now() - interval '1 hour';
  insert into private.registro_agente_intentos(clave) values (p_clave);
  select count(*) into v_count from private.registro_agente_intentos where clave=p_clave and intentado_at > now() - interval '1 hour';
  return v_count;
end $$;
revoke all on function private.registrar_intento_registro(text) from public,anon,authenticated;
grant execute on function private.registrar_intento_registro(text) to service_role;

-- Vincula personal ↔ profile tras crear el usuario en Auth (API, service role). Re-valida todo
-- por si hubo una carrera entre la primera verificación y este paso.
create function private.vincular_agente(p_user_id uuid, p_dni text, p_codigo_personal text)
returns public.personal language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_personal public.personal;
begin
  select * into v_personal from public.personal
    where dni=btrim(p_dni) and codigo_personal=btrim(p_codigo_personal) and activo and profile_id is null
    for update;
  if not found then raise exception 'No se encontró un colaborador activo con ese DNI y código, o ya tiene una cuenta' using errcode='P0002'; end if;
  update public.profiles set role='agente', nombre=v_personal.nombre where id=p_user_id;
  update public.personal set profile_id=p_user_id where id=v_personal.id returning * into v_personal;
  return v_personal;
end $$;
revoke all on function private.vincular_agente(uuid,text,text) from public,anon,authenticated;
grant execute on function private.vincular_agente(uuid,text,text) to service_role;

alter table public.personal enable row level security;
-- (ya estaba forzada por 202609020005; se repite el flag por claridad, es idempotente en Postgres.)

-- ============================================================================
-- Capacitaciones, materiales, asignación
-- ============================================================================
create table public.capacitaciones (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (char_length(titulo) between 3 and 200),
  descripcion text check (descripcion is null or char_length(descripcion) <= 2000),
  capacitador_id uuid not null references public.profiles(id),
  video_path text, video_nombre text, video_sha256 text, video_bytes integer,
  material_pdf_path text, material_pdf_nombre text,
  porcentaje_minimo_visto integer not null default 80 check (porcentaje_minimo_visto between 1 and 100),
  nota_minima integer not null default 3 check (nota_minima >= 0),
  fecha_vencimiento date,
  estado text not null default 'BORRADOR' check (estado in ('BORRADOR','PUBLICADA','ARCHIVADA')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index capacitaciones_capacitador_idx on public.capacitaciones(capacitador_id, created_at desc);

create table public.capacitacion_asignaciones (
  id uuid primary key default gen_random_uuid(),
  capacitacion_id uuid not null references public.capacitaciones(id) on delete cascade,
  cliente_id uuid references public.clientes(id), -- null = asignación global (todos los agentes)
  created_at timestamptz not null default now(),
  unique (capacitacion_id, cliente_id)
);
create unique index capacitacion_asignaciones_global_uidx on public.capacitacion_asignaciones(capacitacion_id) where cliente_id is null;

create table public.examen_preguntas (
  id uuid primary key default gen_random_uuid(),
  capacitacion_id uuid not null references public.capacitaciones(id) on delete cascade,
  enunciado text not null check (char_length(enunciado) between 3 and 500),
  orden integer not null default 0,
  created_at timestamptz not null default now()
);
create index examen_preguntas_capacitacion_idx on public.examen_preguntas(capacitacion_id, orden);

create table public.examen_opciones (
  id uuid primary key default gen_random_uuid(),
  pregunta_id uuid not null references public.examen_preguntas(id) on delete cascade,
  texto text not null check (char_length(texto) between 1 and 300),
  es_correcta boolean not null default false,
  orden integer not null default 0
);
create index examen_opciones_pregunta_idx on public.examen_opciones(pregunta_id, orden);

-- Progreso de video: SOLO se escribe vía RPC (registrar_progreso_video), nunca directo desde el
-- cliente -- es el dato que garantiza "vio al menos el 80%" antes de desbloquear el examen.
create table public.capacitacion_progreso (
  id uuid primary key default gen_random_uuid(),
  capacitacion_id uuid not null references public.capacitaciones(id) on delete cascade,
  agente_id uuid not null references public.profiles(id),
  porcentaje_visto integer not null default 0 check (porcentaje_visto between 0 and 100),
  video_completo boolean not null default false,
  primera_vista_at timestamptz,
  ultima_vista_at timestamptz,
  unique (capacitacion_id, agente_id)
);
create index capacitacion_progreso_agente_idx on public.capacitacion_progreso(agente_id);

create table public.examen_intentos (
  id uuid primary key default gen_random_uuid(),
  capacitacion_id uuid not null references public.capacitaciones(id) on delete cascade,
  agente_id uuid not null references public.profiles(id),
  numero_intento integer not null check (numero_intento > 0),
  puntaje integer not null check (puntaje >= 0),
  total_preguntas integer not null check (total_preguntas > 0),
  aprobado boolean not null,
  created_at timestamptz not null default now(),
  unique (capacitacion_id, agente_id, numero_intento)
);
create index examen_intentos_capacitacion_idx on public.examen_intentos(capacitacion_id, agente_id, numero_intento desc);

create table public.examen_intento_respuestas (
  id bigint generated always as identity primary key,
  intento_id uuid not null references public.examen_intentos(id) on delete cascade,
  pregunta_id uuid not null references public.examen_preguntas(id),
  opcion_id uuid references public.examen_opciones(id),
  correcta boolean not null
);
create index examen_intento_respuestas_intento_idx on public.examen_intento_respuestas(intento_id);

alter table public.capacitaciones enable row level security; alter table public.capacitaciones force row level security;
alter table public.capacitacion_asignaciones enable row level security; alter table public.capacitacion_asignaciones force row level security;
alter table public.examen_preguntas enable row level security; alter table public.examen_preguntas force row level security;
alter table public.examen_opciones enable row level security; alter table public.examen_opciones force row level security;
alter table public.capacitacion_progreso enable row level security; alter table public.capacitacion_progreso force row level security;
alter table public.examen_intentos enable row level security; alter table public.examen_intentos force row level security;
alter table public.examen_intento_respuestas enable row level security; alter table public.examen_intento_respuestas force row level security;
revoke all on public.capacitaciones,public.capacitacion_asignaciones,public.examen_preguntas,public.examen_opciones,
  public.capacitacion_progreso,public.examen_intentos,public.examen_intento_respuestas from public,anon,authenticated;

-- Chequea asignación (global o por cliente_actual_id del agente) vía security definer, porque la
-- política de "capacitaciones" hace un exists() sobre capacitacion_asignaciones, tabla que el
-- propio agente NO puede leer directamente (mismo motivo que private.es_gerente(): una política
-- no puede depender de que el llamador tenga acceso de lectura a la tabla referenciada).
create function private.capacitacion_asignada_a_mi(p_capacitacion_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
  select exists(
    select 1 from public.capacitacion_asignaciones a
    where a.capacitacion_id=p_capacitacion_id
      and (a.cliente_id is null or a.cliente_id=(select p.cliente_actual_id from public.personal p where p.profile_id=auth.uid()))
  );
$$;
revoke all on function private.capacitacion_asignada_a_mi(uuid) from public,anon,authenticated;
grant execute on function private.capacitacion_asignada_a_mi(uuid) to authenticated;

create policy capacitaciones_lectura on public.capacitaciones for select to authenticated
using (public.is_admin() or private.es_capacitador() or (estado='PUBLICADA' and private.capacitacion_asignada_a_mi(id)));
create policy capacitaciones_insert on public.capacitaciones for insert to authenticated
with check (capacitador_id=auth.uid() and (private.es_capacitador() or public.is_admin()));
create policy capacitaciones_update on public.capacitaciones for update to authenticated
using (capacitador_id=auth.uid() or public.is_admin()) with check (capacitador_id=auth.uid() or public.is_admin());
grant select,insert,update on public.capacitaciones to authenticated;

create policy capacitacion_asignaciones_rw on public.capacitacion_asignaciones for all to authenticated
using (public.is_admin() or exists(select 1 from public.capacitaciones c where c.id=capacitacion_id and c.capacitador_id=auth.uid()))
with check (public.is_admin() or exists(select 1 from public.capacitaciones c where c.id=capacitacion_id and c.capacitador_id=auth.uid()));
grant select,insert,update,delete on public.capacitacion_asignaciones to authenticated;

create policy examen_preguntas_rw on public.examen_preguntas for all to authenticated
using (public.is_admin() or exists(select 1 from public.capacitaciones c where c.id=capacitacion_id and c.capacitador_id=auth.uid()))
with check (public.is_admin() or exists(select 1 from public.capacitaciones c where c.id=capacitacion_id and c.capacitador_id=auth.uid()));
grant select,insert,update,delete on public.examen_preguntas to authenticated;

create policy examen_opciones_rw on public.examen_opciones for all to authenticated
using (public.is_admin() or exists(select 1 from public.examen_preguntas q join public.capacitaciones c on c.id=q.capacitacion_id where q.id=pregunta_id and c.capacitador_id=auth.uid()))
with check (public.is_admin() or exists(select 1 from public.examen_preguntas q join public.capacitaciones c on c.id=q.capacitacion_id where q.id=pregunta_id and c.capacitador_id=auth.uid()));
grant select,insert,update,delete on public.examen_opciones to authenticated;

-- capacitacion_progreso: agente NUNCA escribe directo (solo vía RPC, abajo). Lectura: el propio
-- agente su fila, o capacitador/admin todas (reportes).
create policy capacitacion_progreso_lectura on public.capacitacion_progreso for select to authenticated
using (agente_id=auth.uid() or public.is_admin() or private.es_capacitador());
grant select on public.capacitacion_progreso to authenticated;

create policy examen_intentos_lectura on public.examen_intentos for select to authenticated
using (agente_id=auth.uid() or public.is_admin() or private.es_capacitador());
grant select on public.examen_intentos to authenticated;
create policy examen_intento_respuestas_lectura on public.examen_intento_respuestas for select to authenticated
using (public.is_admin() or private.es_capacitador() or exists(select 1 from public.examen_intentos i where i.id=intento_id and i.agente_id=auth.uid()));
grant select on public.examen_intento_respuestas to authenticated;

-- ============================================================================
-- RPCs de capacitador/admin: publicar (valida que haya video + al menos 1 pregunta con 1 opción
-- correcta) y asignar (cliente o global).
-- ============================================================================
create function public.publicar_capacitacion(p_capacitacion_id uuid) returns public.capacitaciones
language plpgsql volatile security invoker set search_path=pg_catalog,public,pg_temp as $$
declare v_cap public.capacitaciones; v_preguntas integer; v_sin_correcta integer;
begin
  select * into v_cap from public.capacitaciones where id=p_capacitacion_id for update;
  if not found then raise exception 'Capacitación no encontrada' using errcode='P0002'; end if;
  if v_cap.video_path is null then raise exception 'La capacitación necesita un video antes de publicarse' using errcode='22023'; end if;
  select count(*) into v_preguntas from public.examen_preguntas where capacitacion_id=p_capacitacion_id;
  if v_preguntas<1 then raise exception 'La capacitación necesita al menos una pregunta de examen' using errcode='22023'; end if;
  select count(*) into v_sin_correcta from public.examen_preguntas q
    where q.capacitacion_id=p_capacitacion_id and not exists(select 1 from public.examen_opciones o where o.pregunta_id=q.id and o.es_correcta);
  if v_sin_correcta>0 then raise exception 'Todas las preguntas necesitan una opción correcta marcada' using errcode='22023'; end if;
  if v_cap.nota_minima > v_preguntas then raise exception 'La nota mínima no puede superar el número de preguntas' using errcode='22023'; end if;
  update public.capacitaciones set estado='PUBLICADA', updated_at=now() where id=p_capacitacion_id returning * into v_cap;
  return v_cap;
end $$;
revoke all on function public.publicar_capacitacion(uuid) from public,anon,authenticated;
grant execute on function public.publicar_capacitacion(uuid) to authenticated;

-- ============================================================================
-- RPCs del agente
-- ============================================================================
create function public.listar_capacitaciones_agente() returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public,pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not private.es_agente() then raise exception 'No autorizado' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.completada, x.fecha_vencimiento nulls last, x.created_at desc),'[]'::jsonb) into v_result
  from (
    select c.id,c.titulo,c.descripcion,c.fecha_vencimiento,c.porcentaje_minimo_visto,c.nota_minima,c.created_at,
      coalesce(pr.porcentaje_visto,0) porcentaje_visto, coalesce(pr.video_completo,false) video_completo,
      (select max(i.puntaje) from public.examen_intentos i where i.capacitacion_id=c.id and i.agente_id=auth.uid() and i.aprobado) is not null completada,
      (select i.puntaje from public.examen_intentos i where i.capacitacion_id=c.id and i.agente_id=auth.uid() order by i.numero_intento desc limit 1) ultima_nota,
      (select count(*) from public.examen_intentos i where i.capacitacion_id=c.id and i.agente_id=auth.uid()) intentos
    from public.capacitaciones c
    left join public.capacitacion_progreso pr on pr.capacitacion_id=c.id and pr.agente_id=auth.uid()
    where c.estado='PUBLICADA' and private.capacitacion_asignada_a_mi(c.id)
  ) x;
  return v_result;
end $$;
revoke all on function public.listar_capacitaciones_agente() from public,anon,authenticated;
grant execute on function public.listar_capacitaciones_agente() to authenticated;

create function public.registrar_progreso_video(p_capacitacion_id uuid, p_porcentaje integer) returns public.capacitacion_progreso
language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_row public.capacitacion_progreso; v_minimo integer; v_pct integer := greatest(0,least(100,coalesce(p_porcentaje,0)));
begin
  if auth.uid() is null or not private.es_agente() then raise exception 'No autorizado' using errcode='42501'; end if;
  if not exists(select 1 from public.capacitaciones where id=p_capacitacion_id and estado='PUBLICADA') or not private.capacitacion_asignada_a_mi(p_capacitacion_id) then
    raise exception 'Capacitación no disponible' using errcode='P0002'; end if;
  select porcentaje_minimo_visto into v_minimo from public.capacitaciones where id=p_capacitacion_id;
  insert into public.capacitacion_progreso(capacitacion_id,agente_id,porcentaje_visto,video_completo,primera_vista_at,ultima_vista_at)
  values (p_capacitacion_id,auth.uid(),v_pct,v_pct>=v_minimo,now(),now())
  on conflict (capacitacion_id,agente_id) do update set
    -- Monotónico: nunca retrocede (evita que un reintento con menos avance "resetee" el progreso).
    porcentaje_visto=greatest(public.capacitacion_progreso.porcentaje_visto,v_pct),
    video_completo=public.capacitacion_progreso.video_completo or v_pct>=v_minimo,
    ultima_vista_at=now()
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.registrar_progreso_video(uuid,integer) from public,anon,authenticated;
grant execute on function public.registrar_progreso_video(uuid,integer) to authenticated;

create function public.iniciar_examen(p_capacitacion_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not private.es_agente() then raise exception 'No autorizado' using errcode='42501'; end if;
  if not exists(select 1 from public.capacitaciones where id=p_capacitacion_id and estado='PUBLICADA') or not private.capacitacion_asignada_a_mi(p_capacitacion_id) then
    raise exception 'Capacitación no disponible' using errcode='P0002'; end if;
  if not coalesce((select video_completo from public.capacitacion_progreso where capacitacion_id=p_capacitacion_id and agente_id=auth.uid()),false) then
    raise exception 'Debes ver al menos el porcentaje mínimo del video antes de rendir el examen' using errcode='55000'; end if;
  select jsonb_build_object('preguntas', coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,'enunciado',q.enunciado,
    'opciones',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'texto',o.texto) order by o.orden,o.id),'[]'::jsonb)
      from public.examen_opciones o where o.pregunta_id=q.id)
  ) order by q.orden,q.id),'[]'::jsonb)) into v_result
  from public.examen_preguntas q where q.capacitacion_id=p_capacitacion_id;
  return v_result;
end $$;
revoke all on function public.iniciar_examen(uuid) from public,anon,authenticated;
grant execute on function public.iniciar_examen(uuid) to authenticated;

-- p_respuestas: jsonb array [{"pregunta_id":"...","opcion_id":"..."}]. Nunca confía en el
-- cliente para calificar: cada opción se valida server-side contra examen_opciones.es_correcta.
create function public.enviar_examen(p_capacitacion_id uuid, p_respuestas jsonb) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_intento_id uuid; v_numero integer; v_total integer; v_puntaje integer := 0; v_nota_minima integer;
  v_aprobado boolean; v_item jsonb; v_pregunta_id uuid; v_opcion_id uuid; v_correcta boolean;
begin
  if auth.uid() is null or not private.es_agente() then raise exception 'No autorizado' using errcode='42501'; end if;
  if not exists(select 1 from public.capacitaciones where id=p_capacitacion_id and estado='PUBLICADA') or not private.capacitacion_asignada_a_mi(p_capacitacion_id) then
    raise exception 'Capacitación no disponible' using errcode='P0002'; end if;
  if not coalesce((select video_completo from public.capacitacion_progreso where capacitacion_id=p_capacitacion_id and agente_id=auth.uid()),false) then
    raise exception 'Debes ver al menos el porcentaje mínimo del video antes de rendir el examen' using errcode='55000'; end if;
  select count(*) into v_total from public.examen_preguntas where capacitacion_id=p_capacitacion_id;
  if v_total<1 or jsonb_typeof(p_respuestas)<>'array' or jsonb_array_length(p_respuestas)<>v_total then
    raise exception 'Debes responder todas las preguntas' using errcode='22023'; end if;
  select nota_minima into v_nota_minima from public.capacitaciones where id=p_capacitacion_id;
  select coalesce(max(numero_intento),0)+1 into v_numero from public.examen_intentos where capacitacion_id=p_capacitacion_id and agente_id=auth.uid();
  insert into public.examen_intentos(capacitacion_id,agente_id,numero_intento,puntaje,total_preguntas,aprobado)
  values (p_capacitacion_id,auth.uid(),v_numero,0,v_total,false) returning id into v_intento_id;
  for v_item in select * from jsonb_array_elements(p_respuestas) loop
    v_pregunta_id := nullif(v_item->>'pregunta_id','')::uuid; v_opcion_id := nullif(v_item->>'opcion_id','')::uuid;
    if not exists(select 1 from public.examen_preguntas where id=v_pregunta_id and capacitacion_id=p_capacitacion_id) then
      raise exception 'Pregunta inválida' using errcode='22023'; end if;
    v_correcta := coalesce((select o.es_correcta from public.examen_opciones o where o.id=v_opcion_id and o.pregunta_id=v_pregunta_id),false);
    if v_correcta then v_puntaje := v_puntaje+1; end if;
    insert into public.examen_intento_respuestas(intento_id,pregunta_id,opcion_id,correcta) values (v_intento_id,v_pregunta_id,v_opcion_id,v_correcta);
  end loop;
  v_aprobado := v_puntaje >= v_nota_minima;
  update public.examen_intentos set puntaje=v_puntaje, aprobado=v_aprobado where id=v_intento_id;
  return jsonb_build_object('intento_id',v_intento_id,'puntaje',v_puntaje,'total',v_total,'nota_minima',v_nota_minima,'aprobado',v_aprobado,'numero_intento',v_numero);
end $$;
revoke all on function public.enviar_examen(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.enviar_examen(uuid,jsonb) to authenticated;

-- Variante de private.capacitacion_asignada_a_mi para un personal_id arbitrario (el reporte
-- recorre a TODOS los agentes asignados, no solo "yo"). Mismo criterio: global o por cliente.
create function private.capacitacion_asignada_a_personal(p_capacitacion_id uuid, p_personal_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
  select exists(
    select 1 from public.capacitacion_asignaciones a
    where a.capacitacion_id=p_capacitacion_id
      and (a.cliente_id is null or a.cliente_id=(select p.cliente_actual_id from public.personal p where p.id=p_personal_id))
  );
$$;
revoke all on function private.capacitacion_asignada_a_personal(uuid,uuid) from public,anon,authenticated;
grant execute on function private.capacitacion_asignada_a_personal(uuid,uuid) to authenticated;

-- ============================================================================
-- Reportes (capacitador/admin): quién no vio, notas, intentos -- exportable en la app igual que
-- ya se hace con SIDIGE (workbook), no se reinventa el exportador aquí.
-- ============================================================================
create function public.reporte_capacitacion(p_capacitacion_id uuid) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public,pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not (public.is_admin() or private.es_capacitador()) then raise exception 'No autorizado' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre),'[]'::jsonb) into v_result from (
    select per.id agente_personal_id, per.nombre, per.codigo_personal,
      coalesce(pr.porcentaje_visto,0) porcentaje_visto, coalesce(pr.video_completo,false) video_completo,
      (select count(*) from public.examen_intentos i where i.capacitacion_id=p_capacitacion_id and i.agente_id=per.profile_id) intentos,
      (select max(i.puntaje) from public.examen_intentos i where i.capacitacion_id=p_capacitacion_id and i.agente_id=per.profile_id) mejor_nota,
      (select bool_or(i.aprobado) from public.examen_intentos i where i.capacitacion_id=p_capacitacion_id and i.agente_id=per.profile_id) aprobado
    from public.personal per
    left join lateral (select * from public.capacitacion_progreso pr where pr.capacitacion_id=p_capacitacion_id and pr.agente_id=per.profile_id) pr on true
    where per.profile_id is not null and per.activo and private.capacitacion_asignada_a_personal(p_capacitacion_id,per.id)
  ) x;
  return v_result;
end $$;
revoke all on function public.reporte_capacitacion(uuid) from public,anon,authenticated;
grant execute on function public.reporte_capacitacion(uuid) to authenticated;

-- Admin/capacitador asignan explícitamente el cliente actual de un agente (para targeting de
-- capacitaciones). Nunca se infiere del campo legado personal.cliente (texto libre).
create function public.admin_asignar_cliente_personal(p_personal_id uuid, p_cliente_id uuid) returns public.personal
language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_row public.personal;
begin
  if auth.uid() is null or not (public.is_admin() or private.es_capacitador()) then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_cliente_id is not null and not exists(select 1 from public.clientes where id=p_cliente_id) then
    raise exception 'Cliente inválido' using errcode='22023'; end if;
  update public.personal set cliente_actual_id=p_cliente_id where id=p_personal_id returning * into v_row;
  if not found then raise exception 'Colaborador no encontrado' using errcode='P0002'; end if;
  return v_row;
end $$;
revoke all on function public.admin_asignar_cliente_personal(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_asignar_cliente_personal(uuid,uuid) to authenticated;

-- ============================================================================
-- Storage: bucket privado para videos + PDFs de capacitación. Rutas deterministas por
-- capacitación (capacitacion_id/video.ext, capacitacion_id/material.pdf), nunca públicas.
-- Límite de 50 MB por archivo: el proyecto Supabase está en plan gratuito, cuyo límite global
-- por archivo es 50 MB (no se puede subir más aunque el bucket lo permitiera).
-- ============================================================================
do $$ begin if to_regclass('storage.buckets') is not null then
 insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('capacitaciones','capacitaciones',false,52428800,array['video/mp4','video/webm','video/quicktime','application/pdf'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
end if; end $$;

do $$ begin if to_regclass('storage.objects') is not null then
 execute $p$create policy capacitaciones_storage_insert on storage.objects for insert to authenticated
  with check(bucket_id='capacitaciones' and (public.is_admin() or private.es_capacitador())
   and exists(select 1 from public.capacitaciones c where c.id::text=(storage.foldername(name))[1] and c.capacitador_id=auth.uid()))$p$;
 execute $p$create policy capacitaciones_storage_update on storage.objects for update to authenticated
  using(bucket_id='capacitaciones' and (public.is_admin() or private.es_capacitador())
   and exists(select 1 from public.capacitaciones c where c.id::text=(storage.foldername(name))[1] and c.capacitador_id=auth.uid()))$p$;
 execute $p$create policy capacitaciones_storage_select on storage.objects for select to authenticated
  using(bucket_id='capacitaciones' and exists(
   select 1 from public.capacitaciones c where c.id::text=(storage.foldername(name))[1]
    and (c.capacitador_id=auth.uid() or public.is_admin() or private.es_capacitador()
      or (c.estado='PUBLICADA' and private.capacitacion_asignada_a_mi(c.id)))
  ))$p$;
 end if; end $$;

notify pgrst,'reload schema';
commit;
