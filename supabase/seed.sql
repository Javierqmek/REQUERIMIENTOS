-- Solo para una instalación de demostración, después de todas las migraciones.
-- No sobrescribe datos existentes.
begin;
insert into public.clientes(nombre) values ('Cliente A'),('Cliente B')
on conflict (nombre) do nothing;

insert into public.unidades(cliente_id,nombre)
select c.id,v.unidad from (values
  ('Cliente A','Planta Pisco'),
  ('Cliente B','Planta Trujillo')
) as v(cliente,unidad) join public.clientes c on c.nombre=v.cliente
on conflict (cliente_id,nombre) do nothing;

insert into public.personal (codigo_personal, nombre, dni, cargo) values
  ('PER001', 'Juan Pérez García', '12345678', 'AVP Simple'),
  ('PER002', 'Carlos Ramírez', '87654321', 'AVP Armado'),
  ('PER003', 'Luis Torres', '45678912', 'Jefe de Grupo')
on conflict (codigo_personal) do nothing;

-- Ficha de la prenda (una sola vez) y su asignación por cliente/renovación con la cantidad que le corresponde.
insert into public.prendas (codigo_prenda, nombre_prenda, genero, codigo_almacen, precio) values
  ('PRE001', 'Pantalón táctico', 'HOMBRE', 'ALM001', 85),
  ('PRE002', 'Camisa manga larga', 'MUJER', 'ALM002', 45),
  ('PRE003', 'Casaca invierno', 'AMBOS', 'ALM003', 120),
  ('PRE005', 'Pantalón azul', 'AMBOS', 'ALM005', 90)
on conflict (codigo_prenda) do nothing;

insert into public.prenda_clientes (prenda_id, cliente_id, renovacion, cantidad)
select p.id, c.id, v.renovacion, v.cantidad from (values
  ('PRE001', 'Cliente A', 'AMBOS', 2),
  ('PRE002', 'Cliente A', 'AMBOS', 2),
  ('PRE003', 'Cliente A', 'INVIERNO', 1),
  ('PRE005', 'Cliente B', 'AMBOS', 2)
) as v(codigo, cliente, renovacion, cantidad)
join public.prendas p on p.codigo_prenda = v.codigo
join public.clientes c on c.nombre = v.cliente
on conflict (prenda_id, cliente_id, renovacion) do nothing;
commit;
