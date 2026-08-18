-- Requerimientos de Uniformes: esquema, seguridad y funciones
create extension if not exists pgcrypto;

create type public.user_role as enum ('supervisor', 'admin');
create type public.estado_requerimiento as enum ('Pendiente', 'Atendido', 'Observado');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nombre text not null default '',
  role public.user_role not null default 'supervisor',
  created_at timestamptz not null default now()
);

create table public.personal (
  id uuid primary key default gen_random_uuid(),
  codigo_personal text not null unique,
  nombre text not null,
  dni text not null,
  cargo text not null,
  cliente text not null,
  unidad text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create index personal_busqueda_idx on public.personal using gin (to_tsvector('simple', nombre || ' ' || dni || ' ' || codigo_personal));

create table public.prendas (
  id uuid primary key default gen_random_uuid(),
  codigo_prenda text not null unique,
  nombre_prenda text not null,
  codigo_almacen text not null,
  precio numeric(12,2) not null check (precio >= 0),
  cliente text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create index prendas_cliente_idx on public.prendas(cliente) where activo;

create table public.requerimientos (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null default now(),
  agente_id uuid not null references public.personal(id),
  usuario_creador_id uuid not null references public.profiles(id),
  referencia_interna text not null default 'RENOVACION VERANO',
  estado public.estado_requerimiento not null default 'Pendiente',
  created_at timestamptz not null default now()
);
create index requerimientos_creador_fecha_idx on public.requerimientos(usuario_creador_id, fecha desc);

create table public.detalle_requerimiento (
  id uuid primary key default gen_random_uuid(),
  requerimiento_id uuid not null references public.requerimientos(id) on delete cascade,
  prenda_id uuid not null references public.prendas(id),
  cantidad integer not null check (cantidad > 0),
  precio_unitario numeric(12,2) not null check (precio_unitario >= 0),
  codigo_almacen text not null,
  created_at timestamptz not null default now(),
  unique (requerimiento_id, prenda_id)
);
create index detalle_requerimiento_id_idx on public.detalle_requerimiento(requerimiento_id);

-- Crea automáticamente un perfil supervisor al registrar un usuario en Auth.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, nombre)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'nombre', split_part(coalesce(new.email,''), '@', 1)));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

alter table public.profiles enable row level security;
alter table public.personal enable row level security;
alter table public.prendas enable row level security;
alter table public.requerimientos enable row level security;
alter table public.detalle_requerimiento enable row level security;

create policy "profile propio o admin" on public.profiles for select to authenticated
using (id = auth.uid() or public.is_admin());

create policy "catalogo personal autenticado" on public.personal for select to authenticated using (activo or public.is_admin());
create policy "catalogo prendas autenticado" on public.prendas for select to authenticated using (activo or public.is_admin());

create policy "leer requerimientos propios o admin" on public.requerimientos for select to authenticated
using (usuario_creador_id = auth.uid() or public.is_admin());
create policy "insertar requerimientos propios" on public.requerimientos for insert to authenticated
with check (usuario_creador_id = auth.uid() and estado = 'Pendiente' and referencia_interna = 'RENOVACION VERANO');
create policy "admin actualiza requerimientos" on public.requerimientos for update to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy "leer detalles propios o admin" on public.detalle_requerimiento for select to authenticated
using (exists (
  select 1 from public.requerimientos r
  where r.id = requerimiento_id and (r.usuario_creador_id = auth.uid() or public.is_admin())
));

-- Incluso un administrador solo puede cambiar el estado desde la API.
create or replace function public.proteger_requerimiento_actualizado()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.id is distinct from old.id
    or new.fecha is distinct from old.fecha
    or new.agente_id is distinct from old.agente_id
    or new.usuario_creador_id is distinct from old.usuario_creador_id
    or new.referencia_interna is distinct from old.referencia_interna
    or new.created_at is distinct from old.created_at then
    raise exception 'Solo se permite cambiar el estado';
  end if;
  return new;
end;
$$;
create trigger proteger_actualizacion_requerimiento before update on public.requerimientos
for each row execute function public.proteger_requerimiento_actualizado();

-- Inserción atómica: cabecera y todos los detalles se confirman o se revierten juntos.
create or replace function public.crear_requerimiento(p_agente_id uuid, p_detalles jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_cliente text;
  v_total integer;
  v_validos integer;
begin
  if auth.uid() is null then raise exception 'Not authorized'; end if;
  select cliente into v_cliente from public.personal where id = p_agente_id and activo;
  if v_cliente is null then raise exception 'Agente inválido o inactivo'; end if;
  if jsonb_typeof(p_detalles) <> 'array' or jsonb_array_length(p_detalles) = 0 then raise exception 'Debe incluir prendas'; end if;

  select count(*), count(distinct x.prenda_id)
  into v_total, v_validos
  from jsonb_to_recordset(p_detalles) as x(prenda_id uuid, cantidad integer)
  where x.cantidad > 0;
  if v_total <> jsonb_array_length(p_detalles) or v_total <> v_validos then raise exception 'Detalles inválidos o duplicados'; end if;

  select count(*) into v_validos
  from jsonb_to_recordset(p_detalles) as x(prenda_id uuid, cantidad integer)
  join public.prendas p on p.id = x.prenda_id and p.activo and p.cliente = v_cliente;
  if v_validos <> v_total then raise exception 'La prenda no corresponde al cliente del agente'; end if;

  insert into public.requerimientos (agente_id, usuario_creador_id)
  values (p_agente_id, auth.uid()) returning id into v_id;

  insert into public.detalle_requerimiento (requerimiento_id, prenda_id, cantidad, precio_unitario, codigo_almacen)
  select v_id, p.id, x.cantidad, p.precio, p.codigo_almacen
  from jsonb_to_recordset(p_detalles) as x(prenda_id uuid, cantidad integer)
  join public.prendas p on p.id = x.prenda_id;
  return v_id;
end;
$$;
revoke all on function public.crear_requerimiento(uuid,jsonb) from public;
grant execute on function public.crear_requerimiento(uuid,jsonb) to authenticated;

grant usage on schema public to authenticated;
grant select on public.profiles, public.personal, public.prendas, public.requerimientos, public.detalle_requerimiento to authenticated;
grant insert on public.requerimientos to authenticated;
grant update (estado) on public.requerimientos to authenticated;
