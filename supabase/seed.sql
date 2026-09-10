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

insert into public.prendas (codigo_prenda, nombre_prenda, genero, codigo_almacen, precio, cliente, cantidad) values
  ('PRE001', 'Pantalón táctico', 'HOMBRE', 'ALM001', 85, 'Cliente A', 2),
  ('PRE002', 'Camisa manga larga', 'MUJER', 'ALM002', 45, 'Cliente A', 2),
  ('PRE003', 'Casaca invierno', 'AMBOS', 'ALM003', 120, 'Cliente A', 1),
  ('PRE005', 'Pantalón azul', 'AMBOS', 'ALM005', 90, 'Cliente B', 2)
on conflict (codigo_prenda) do nothing;
commit;
