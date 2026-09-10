# Clasificación por género del maestro de prendas

## Resultado

La migración 202609100001_prendas_genero.sql añade public.prendas.genero sin borrar filas ni modificar requerimientos o detalles históricos. Los registros existentes reciben AMBOS. RLS, roles, permisos, funciones de creación/edición, cantidades, precios, códigos y baja lógica se conservan.

No se ejecutó esta migración en Supabase remoto. El frontend nuevo debe desplegarse después de aplicar la migración, porque solicita la columna genero.

## SQL a ejecutar

En una instalación existente, aplica únicamente el contenido completo de supabase/migrations/202609100001_prendas_genero.sql, después de 202609020006_security_advisor_hardening.sql. Haz respaldo y pruébala primero en staging. Es transaccional y:

- agrega genero text not null default AMBOS;
- limita los valores almacenados a HOMBRE, MUJER y AMBOS;
- normaliza cada INSERT/UPDATE mediante trigger;
- agrega un índice parcial para cliente + género + nombre sobre prendas activas;
- no concede permisos nuevos ni desactiva RLS.

El trigger no se expone como RPC a PUBLIC, anon o authenticated.

## Importación CSV/Excel

Orden: clientes → unidades → personal → prendas. Para prendas:

codigo_prenda,nombre_prenda,genero,codigo_almacen,precio,cantidad,cliente,activo

No incluyas id ni created_at. Mantén códigos como texto. cliente debe coincidir exactamente con public.clientes.nombre, cantidad debe ser un entero positivo y precio no negativo.

| Entrada | Valor almacenado |
| --- | --- |
| HOMBRE con espacios/minúsculas | HOMBRE |
| MUJER con espacios/minúsculas | MUJER |
| HOMBRE /MUJER | AMBOS |
| HOMBRE/MUJER | AMBOS |
| UNISEX | AMBOS |
| AMBOS con espacios/minúsculas | AMBOS |

Cualquier otro valor se rechaza. Si genero se omite, se usa AMBOS.

## Interfaz y reglas

Después de Agente → Cliente → Unidad aparecen dos opciones segmentadas, Hombre y Mujer:

- Hombre consulta HOMBRE + AMBOS;
- Mujer consulta MUJER + AMBOS;
- AMBOS se presenta como “Unisex”.

El filtro se ejecuta en Supabase por cliente y género y se verifica de nuevo en memoria. Si cambiar la opción elimina líneas, se pide confirmación; al confirmar se retiran solo incompatibles y se conservan AMBOS. Cancelar mantiene la selección. No se envía género, cantidad, precio ni código a la RPC.

En edición se infiere la opción cuando existe un solo género específico más posibles AMBOS. Con solo AMBOS, o HOMBRE y MUJER simultáneamente, el usuario elige antes de agregar. Agente, cliente y unidad siguen siendo solo lectura; Atendido continúa bloqueado.

## SIDIGE e historial

No se agregó género a detalle_requerimiento. Los snapshots históricos no cambian. CSV administrativo no cambia y Excel SIDIGE conserva exactamente sus diez columnas. El género actual del maestro no reescribe líneas existentes.

## Validación local

- nueve migraciones reconstruidas desde cero en PostgreSQL 18;
- seis suites SQL: 174 comprobaciones aprobadas;
- npm test: 93 pruebas aprobadas, incluido SIDIGE de diez columnas;
- 29 pruebas Playwright aisladas en Edge en 1440×900, 1366×768, 390×844, 375×812 y 320×700;
- Hombre/Mujer, AMBOS, confirmación/cancelación, retiro selectivo, Atendido y ausencia de overflow;
- lint, typecheck y build.

Las pruebas usan datos ficticios y no conectan a Supabase remoto.
