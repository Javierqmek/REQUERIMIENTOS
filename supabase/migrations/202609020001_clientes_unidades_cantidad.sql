-- Ejecutar después de 202608170002_performance.sql. No elimina datos ni políticas.
begin;

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.unidades (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id),
  nombre text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (cliente_id, nombre),
  unique (id, cliente_id)
);

-- Conservamos los valores antiguos; nuevas importaciones ya no los necesitan.
alter table public.personal alter column cliente drop not null;
alter table public.personal alter column unidad drop not null;
comment on column public.personal.cliente is 'Legado: no usar para nuevos requerimientos. Conservado sin borrar datos.';
comment on column public.personal.unidad is 'Legado: no usar para nuevos requerimientos. Conservado sin borrar datos.';

alter table public.prendas add column cantidad integer not null default 1
  constraint prendas_cantidad_positiva check (cantidad > 0);
alter table public.requerimientos
  add column cliente_id uuid references public.clientes(id),
  add column unidad_id uuid references public.unidades(id);
alter table public.requerimientos add constraint requerimientos_unidad_cliente_fkey
  foreign key (unidad_id, cliente_id) references public.unidades(id, cliente_id);

-- Mantener nombres exactos para compatibilidad con prendas.cliente.
insert into public.clientes(nombre)
select cliente from public.personal where nullif(btrim(cliente), '') is not null
union
select cliente from public.prendas where nullif(btrim(cliente), '') is not null
on conflict (nombre) do nothing;
insert into public.unidades(cliente_id,nombre)
select distinct c.id,p.unidad from public.personal p
join public.clientes c on c.nombre=p.cliente
where nullif(btrim(p.unidad), '') is not null
on conflict (cliente_id,nombre) do nothing;

-- El trigger anterior permite actualizar estas columnas nuevas, no las antiguas.
update public.requerimientos r set cliente_id=c.id
from public.personal p join public.clientes c on c.nombre=p.cliente
where r.agente_id=p.id and r.cliente_id is null;
update public.requerimientos r set unidad_id=u.id
from public.personal p join public.clientes c on c.nombre=p.cliente
join public.unidades u on u.cliente_id=c.id and u.nombre=p.unidad
where r.agente_id=p.id and r.cliente_id=c.id and r.unidad_id is null;

create index requerimientos_cliente_fecha_idx on public.requerimientos(cliente_id,fecha desc);
create index requerimientos_unidad_idx on public.requerimientos(unidad_id);
create index clientes_activos_nombre_idx on public.clientes(nombre) where activo;
create index unidades_activas_cliente_nombre_idx on public.unidades(cliente_id,nombre) where activo;

alter table public.clientes enable row level security;
alter table public.unidades enable row level security;
create policy clientes_lectura on public.clientes for select to authenticated
using (activo or (select public.is_admin()));
create policy unidades_lectura on public.unidades for select to authenticated
using (activo or (select public.is_admin()));
-- Destinos inactivos referenciados por historial accesible siguen siendo legibles.
-- Estas subconsultas aplican las políticas existentes de requerimientos.
create policy clientes_historial on public.clientes for select to authenticated
using (exists(select 1 from public.requerimientos r where r.cliente_id=clientes.id));
create policy unidades_historial on public.unidades for select to authenticated
using (exists(select 1 from public.requerimientos r where r.unidad_id=unidades.id));
create policy clientes_admin_insert on public.clientes for insert to authenticated
with check ((select public.is_admin()));
create policy clientes_admin_update on public.clientes for update to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
create policy unidades_admin_insert on public.unidades for insert to authenticated
with check ((select public.is_admin()));
create policy unidades_admin_update on public.unidades for update to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.clientes,public.unidades from anon,authenticated;
grant select,insert,update on public.clientes,public.unidades to authenticated;

-- Añadir restricción sin quitar ninguna política existente.
-- NULL sigue permitido en datos históricos, pero no en solicitudes nuevas.
create policy requerimientos_destino_obligatorio on public.requerimientos
as restrictive for insert to authenticated
with check (cliente_id is not null and unidad_id is not null);

create or replace function public.proteger_requerimiento_actualizado()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.id is distinct from old.id or new.fecha is distinct from old.fecha
    or new.agente_id is distinct from old.agente_id
    or new.usuario_creador_id is distinct from old.usuario_creador_id
    or new.cliente_id is distinct from old.cliente_id
    or new.unidad_id is distinct from old.unidad_id
    or new.referencia_interna is distinct from old.referencia_interna
    or new.created_at is distinct from old.created_at then
    raise exception 'Solo se permite cambiar el estado';
  end if;
  return new;
end;
$$;

create function public.validar_destino_requerimiento()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.cliente_id is null or new.unidad_id is null then
    raise exception 'Selecciona un cliente y una unidad';
  end if;
  if not exists(select 1 from public.clientes c join public.unidades u
      on u.cliente_id=c.id where c.id=new.cliente_id and u.id=new.unidad_id
      and c.activo and u.activo) then
    raise exception 'Cliente o unidad inválidos o inactivos';
  end if;
  return new;
end;
$$;
create trigger validar_destino_requerimiento before insert on public.requerimientos
for each row execute function public.validar_destino_requerimiento();

-- Conservar firma antigua con error explícito: nunca inferir destinos del agente
-- ni permitir que un navegador antiguo envíe cantidades editables.
create or replace function public.crear_requerimiento(p_agente_id uuid,p_detalles jsonb)
returns uuid language plpgsql security invoker set search_path=public as $$
begin
  raise exception 'Actualiza la aplicación: ahora debes seleccionar cliente y unidad';
end;
$$;

create function public.crear_requerimiento(
  p_agente_id uuid,p_cliente_id uuid,p_unidad_id uuid,p_detalles jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_id uuid;
  v_cliente text;
  v_prendas uuid[];
  v_count integer;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then
    raise exception 'Not authorized';
  end if;
  perform id from public.personal where id=p_agente_id and activo for share;
  if not found then raise exception 'Agente inválido o inactivo'; end if;
  select nombre into v_cliente from public.clientes
    where id=p_cliente_id and activo for share;
  if not found then raise exception 'Selecciona un cliente activo'; end if;
  perform id from public.unidades where id=p_unidad_id
    and cliente_id=p_cliente_id and activo for share;
  if not found then raise exception 'Selecciona una unidad activa del cliente'; end if;
  if p_detalles is null or jsonb_typeof(p_detalles)<>'array' then
    raise exception 'Debe incluir prendas';
  end if;
  if jsonb_array_length(p_detalles)=0 then raise exception 'Debe incluir prendas'; end if;
  select array_agg(x.prenda_id),count(distinct x.prenda_id)
    into v_prendas,v_count from jsonb_to_recordset(p_detalles) as x(prenda_id uuid);
  if v_count<>jsonb_array_length(p_detalles) then
    raise exception 'Detalles inválidos o duplicados';
  end if;
  -- Mantener estable el maestro mientras se copian cantidad/precio/código.
  perform id from public.prendas where id=any(v_prendas)
    and activo and cliente=v_cliente order by id for share;
  get diagnostics v_count=row_count;
  if v_count<>cardinality(v_prendas) then
    raise exception 'La prenda no corresponde al cliente seleccionado o está inactiva';
  end if;
  insert into public.requerimientos(agente_id,usuario_creador_id,cliente_id,unidad_id)
    values(p_agente_id,auth.uid(),p_cliente_id,p_unidad_id) returning id into v_id;
  insert into public.detalle_requerimiento(requerimiento_id,prenda_id,cantidad,precio_unitario,codigo_almacen)
    select v_id,p.id,p.cantidad,p.precio,p.codigo_almacen from public.prendas p
    where p.id=any(v_prendas);
  return v_id;
end;
$$;
revoke all on function public.crear_requerimiento(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.crear_requerimiento(uuid,uuid,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
