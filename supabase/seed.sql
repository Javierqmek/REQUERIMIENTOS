insert into public.personal (codigo_personal, nombre, dni, cargo, cliente, unidad) values
  ('PER001', 'Juan Pérez García', '12345678', 'AVP Simple', 'Cliente A', 'Planta Pisco'),
  ('PER002', 'Carlos Ramírez', '87654321', 'AVP Armado', 'Cliente A', 'Planta Pisco'),
  ('PER003', 'Luis Torres', '45678912', 'Jefe de Grupo', 'Cliente B', 'Planta Trujillo')
on conflict (codigo_personal) do update set nombre=excluded.nombre, dni=excluded.dni, cargo=excluded.cargo, cliente=excluded.cliente, unidad=excluded.unidad;

insert into public.prendas (codigo_prenda, nombre_prenda, codigo_almacen, precio, cliente) values
  ('PRE001', 'Pantalón táctico', 'ALM001', 85, 'Cliente A'),
  ('PRE002', 'Camisa manga larga', 'ALM002', 45, 'Cliente A'),
  ('PRE003', 'Casaca invierno', 'ALM003', 120, 'Cliente A'),
  ('PRE005', 'Pantalón azul', 'ALM005', 90, 'Cliente B')
on conflict (codigo_prenda) do update set nombre_prenda=excluded.nombre_prenda, codigo_almacen=excluded.codigo_almacen, precio=excluded.precio, cliente=excluded.cliente;
