-- Importación de personal segura: se identifica por DNI, nunca pisa datos en silencio y nunca toca la vinculación.
-- Aplicar después de 202610070001. UNA sola ejecución (transacción única).
--
-- Problemas de la importación anterior (admin_importar_catalogo('personal')):
--  * exigía los encabezados exactos codigo_personal,nombre,dni,cargo,activo (un archivo sin cargo se rechazaba),
--    solo coma, máximo 1000 filas y DNI de 8 a 12 dígitos tal cual (Excel quita los ceros iniciales);
--  * hacía upsert por codigo_personal y SOBRESCRIBÍA nombre, dni, cargo y activo sin avisar: un código repetido de
--    otra persona le cambiaba el DNI, y una persona con el mismo DNI y otro código se duplicaba;
--  * un código repetido dentro del archivo se descartaba sin error.
-- Ahora: public.admin_importar_personal (vista previa y aplicación en una transacción, hasta 5000 filas).
--  * Nueva (DNI no existe) -> se crea. Existente con los mismos datos -> se ignora y se cuenta. Existente con datos
--    distintos (nombre, código, cargo si el archivo lo trae, estado) -> se lista y solo se actualiza si se pide.
--  * Nunca modifica profile_id, email ni cliente_actual_id (la vinculación de agentes) y nunca desactiva a quien no
--    viene en el archivo.
--  * Errores por fila: código ya perteneciente a otro DNI, DNI repetido en la base (no hay restricción única).
--  * El DNI se compara completando con ceros a la izquierda cuando está guardado con menos de 8 dígitos.
-- Se elimina admin_importar_catalogo (solo servía para esto y las prendas ya se importan por cliente).
begin;

drop function public.admin_importar_catalogo(text,jsonb);
drop function private.admin_importar_catalogo(text,jsonb);

create function private.admin_importar_personal(p_filas jsonb,p_aplicar boolean,
  p_actualizar jsonb default '[]'::jsonb,p_cargo_defecto text default 'AGENTE')
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  v_cargo text:=btrim(coalesce(p_cargo_defecto,''));
  v_nuevos integer; v_igual integer; v_dif jsonb; v_err jsonb; v_antes jsonb; v_creados jsonb:='[]'::jsonb; v_act integer:=0;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_aplicar is null or p_actualizar is null or jsonb_typeof(p_actualizar)<>'array' or jsonb_array_length(p_actualizar)>5000
    or v_cargo='' or length(v_cargo)>120 then raise exception 'Datos inválidos' using errcode='22023'; end if;
  if p_filas is null or jsonb_typeof(p_filas)<>'array' or jsonb_array_length(p_filas)<1 or jsonb_array_length(p_filas)>5000
    or octet_length(p_filas::text)>3145728 then raise exception 'Importación inválida (1 a 5000 filas)' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_filas) e where jsonb_typeof(e.value)<>'object'
      or (e.value-'fila'-'codigo_personal'-'nombre'-'dni'-'cargo'-'activo')<>'{}'::jsonb
      or (e.value->>'fila')!~'^[1-9][0-9]{0,6}$'
      or nullif(btrim(e.value->>'codigo_personal'),'') is null or length(btrim(e.value->>'codigo_personal'))>80
      or nullif(btrim(e.value->>'nombre'),'') is null or length(btrim(e.value->>'nombre'))>200
      or coalesce(e.value->>'dni','')!~'^[0-9]{8}$'
      or (e.value->>'cargo' is not null and length(btrim(e.value->>'cargo'))>120)
      or jsonb_typeof(e.value->'activo')<>'boolean') then
    raise exception 'Hay filas de personal inválidas (la pantalla las valida con su número de fila)' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('importar_personal',0));

  drop table if exists pg_temp.imp_p; drop table if exists pg_temp.imp_mt; drop table if exists pg_temp.imp_e;
  create temp table imp_p on commit drop as
    select (e.value->>'fila')::integer as fila,btrim(e.value->>'codigo_personal') as codigo,regexp_replace(btrim(e.value->>'nombre'),'\s+',' ','g') as nombre,
      e.value->>'dni' as dni,nullif(btrim(coalesce(e.value->>'cargo','')),'') as cargo,(e.value->'activo')::boolean as activo
    from jsonb_array_elements(p_filas) e;
  -- Defensa: la pantalla ya marca estos errores por fila; aquí nunca se acepta algo ambiguo.
  if exists(select 1 from pg_temp.imp_p group by dni having count(*)>1) then
    raise exception 'El archivo repite un DNI' using errcode='22023'; end if;
  if exists(select 1 from pg_temp.imp_p group by codigo having count(*)>1) then
    raise exception 'El archivo repite un código de personal' using errcode='22023'; end if;

  -- Emparejar por DNI (los guardados con menos de 8 dígitos se completan con ceros para comparar).
  create temp table imp_mt on commit drop as
    select p.fila,p.codigo,p.nombre,p.dni,p.cargo,p.activo,per.id as pid,per.codigo_personal as c_act,per.nombre as n_act,
      per.cargo as cargo_act,per.activo as act_act,per.dni as dni_act,(per.profile_id is not null) as vinculado,
      count(per.id) over (partition by p.fila) as n
    from pg_temp.imp_p p left join public.personal per
      on (case when per.dni ~ '^[0-9]{1,7}$' then lpad(per.dni,8,'0') else per.dni end)=p.dni;
  create temp table imp_e on commit drop as
    select distinct m.fila,m.codigo,
      case when m.n>1 then 'El DNI '||m.dni||' está repetido en la base de datos ('||m.n||' personas): corrígelo antes de importar'
        else 'El código '||m.codigo||' ya pertenece a otra persona (DNI '||x.dni||')' end as mensaje
    from pg_temp.imp_mt m
    left join public.personal x on x.codigo_personal=m.codigo and x.id is distinct from m.pid
    where m.n>1 or x.id is not null;
  select coalesce(jsonb_agg(jsonb_build_object('fila',e.fila,'codigo',e.codigo,'mensaje',e.mensaje) order by e.fila),'[]'::jsonb)
    into v_err from pg_temp.imp_e e;

  select count(*) filter(where m.pid is null),
         count(*) filter(where m.pid is not null and m.c_act=m.codigo and lower(regexp_replace(btrim(m.n_act),'\s+',' ','g'))=lower(m.nombre)
           and m.dni_act=m.dni and (m.cargo is null or lower(btrim(m.cargo_act))=lower(m.cargo)) and m.act_act=m.activo)
    into v_nuevos,v_igual from pg_temp.imp_mt m where m.n<=1 and not exists(select 1 from pg_temp.imp_e e where e.fila=m.fila);

  -- Existentes con datos distintos: valor actual y del archivo (no se cambian salvo que se pida).
  select coalesce(jsonb_agg(jsonb_build_object('fila',d.fila,'dni',d.dni,'nombre',d.n_act,'codigo_personal',d.c_act,'vinculado',d.vinculado,
    'cambios',d.cambios) order by d.fila),'[]'::jsonb) into v_dif
  from (select m.fila,m.dni,m.n_act,m.c_act,m.vinculado,(select jsonb_agg(c.j) from (
      select jsonb_build_object('campo','codigo_personal','actual',m.c_act,'archivo',m.codigo) j where m.c_act<>m.codigo
      union all select jsonb_build_object('campo','nombre','actual',m.n_act,'archivo',m.nombre) where lower(regexp_replace(btrim(m.n_act),'\s+',' ','g'))<>lower(m.nombre)
      union all select jsonb_build_object('campo','dni','actual',m.dni_act,'archivo',m.dni) where m.dni_act<>m.dni
      union all select jsonb_build_object('campo','cargo','actual',m.cargo_act,'archivo',m.cargo) where m.cargo is not null and lower(btrim(m.cargo_act))<>lower(m.cargo)
      union all select jsonb_build_object('campo','activo','actual',case when m.act_act then 'Activo' else 'Inactivo' end,'archivo',case when m.activo then 'Activo' else 'Inactivo' end) where m.act_act<>m.activo) c) cambios
    from pg_temp.imp_mt m where m.n=1 and not exists(select 1 from pg_temp.imp_e e where e.fila=m.fila)) d where d.cambios is not null;

  if p_aplicar then
    select coalesce(jsonb_agg(jsonb_build_object('id',per.id,'dni',per.dni,'codigo_personal',per.codigo_personal,'nombre',per.nombre,
      'cargo',per.cargo,'activo',per.activo) order by per.codigo_personal),'[]'::jsonb) into v_antes
    from public.personal per where per.id in (select m.pid from pg_temp.imp_mt m where m.n=1 and m.dni in (select x#>>'{}' from jsonb_array_elements(p_actualizar) x));
    with ins as (
      insert into public.personal(codigo_personal,nombre,dni,cargo,activo)
      select m.codigo,m.nombre,m.dni,coalesce(m.cargo,v_cargo),m.activo from pg_temp.imp_mt m
      where m.pid is null and not exists(select 1 from pg_temp.imp_e e where e.fila=m.fila)
      returning id,codigo_personal,dni)
    select coalesce(jsonb_agg(jsonb_build_object('codigo_personal',i.codigo_personal,'dni',i.dni)),'[]'::jsonb) into v_creados from ins i;
    -- Actualización explícita: solo nombre, código, dni, cargo (si el archivo lo trae) y estado. Jamás profile_id,
    -- email ni cliente_actual_id.
    update public.personal per set codigo_personal=m.codigo,nombre=m.nombre,dni=m.dni,cargo=coalesce(m.cargo,per.cargo),activo=m.activo
      from pg_temp.imp_mt m
      where per.id=m.pid and m.n=1 and not exists(select 1 from pg_temp.imp_e e where e.fila=m.fila)
        and m.dni in (select x#>>'{}' from jsonb_array_elements(p_actualizar) x)
        and (m.c_act<>m.codigo or lower(regexp_replace(btrim(m.n_act),'\s+',' ','g'))<>lower(m.nombre) or m.dni_act<>m.dni
          or (m.cargo is not null and lower(btrim(m.cargo_act))<>lower(m.cargo)) or m.act_act<>m.activo);
    get diagnostics v_act=row_count;
    insert into private.admin_catalog_audit(usuario_id,accion,catalogo,registro_id,valores_antes,valores_despues)
    values(auth.uid(),'IMPORTAR','personal',auth.uid(),v_antes,jsonb_build_object('filas',jsonb_array_length(p_filas),
      'nuevos',jsonb_array_length(v_creados),'creados',v_creados,'sin_cambios',v_igual,'con_diferencias',jsonb_array_length(v_dif),
      'actualizados',v_act,'actualizar_dnis',p_actualizar,'errores',jsonb_array_length(v_err),'cargo_defecto',v_cargo));
  end if;

  return jsonb_build_object('aplicado',p_aplicar,'nuevos',v_nuevos,'sin_cambios',v_igual,'diferencias',v_dif,'errores',v_err,
    'actualizados',v_act);
end $$;
revoke all on function private.admin_importar_personal(jsonb,boolean,jsonb,text) from public,anon,authenticated;
grant execute on function private.admin_importar_personal(jsonb,boolean,jsonb,text) to authenticated;
create function public.admin_importar_personal(p_filas jsonb,p_aplicar boolean default false,
  p_actualizar jsonb default '[]'::jsonb,p_cargo_defecto text default 'AGENTE') returns jsonb
language sql volatile security invoker set search_path=pg_catalog,pg_temp as $$
  select private.admin_importar_personal(p_filas,p_aplicar,p_actualizar,p_cargo_defecto);
$$;
revoke all on function public.admin_importar_personal(jsonb,boolean,jsonb,text) from public,anon,authenticated;
grant execute on function public.admin_importar_personal(jsonb,boolean,jsonb,text) to authenticated;

notify pgrst,'reload schema';
commit;
