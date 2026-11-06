-- SOLO LECTURA. Ejecutar en el SQL Editor ANTES de aplicar 202611060001: lista los valores distintos de personal.cargo
-- (los que la migración cargará al catálogo de cargos), con cuántas personas los tienen. Las variantes que solo difieren en
-- mayúsculas o espacios (p. ej. "Agente " y "AGENTE") se unifican con la forma más usada.
select cargo as valor_tal_como_esta, '[' || cargo || ']' as con_corchetes, count(*) as personas,
       count(*) filter (where activo) as activas
from public.personal
group by cargo
order by lower(btrim(cargo)), count(*) desc;

-- Después de aplicar la migración, los cargos que ya existían (origen 'existente') y los que se agregaron (origen 'inicial'):
-- select nombre, origen, activo, (select count(*) from public.personal p where p.cargo = c.nombre) as personas from public.cargos c order by origen, nombre;
