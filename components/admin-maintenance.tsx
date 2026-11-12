"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import { Download,EllipsisVertical,LoaderCircle,Plus,RotateCcw,Search } from "lucide-react";
import { AdminCatalogDialog } from "@/components/admin-catalog-dialog";
import { AdminSectionNav } from "@/components/admin-section-nav";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Toast } from "@/components/ui/toast";
import type { CatalogKind,CatalogResult } from "@/lib/admin/maintenance";
import { prendasFilterParams,type PrendasFilters } from "@/lib/admin/prendas-filters";
import { renovacionLabel,type PrendaRenovacion } from "@/lib/garments/renovacion";
import { genderLabel,type GarmentGender } from "@/lib/garments/gender";

const catalogs:{id:CatalogKind;label:string}[]=[{id:"clientes",label:"Clientes"},{id:"unidades",label:"Unidades"},{id:"personal",label:"Personal"},{id:"prendas",label:"Prendas"},{id:"provincias",label:"Provincias"},{id:"puestos",label:"Puestos"},{id:"cargos",label:"Cargos"}];
type Client={id:string;nombre:string;activo:boolean;diferencia_puestos?:boolean};
type PuestoOption={id:string;cliente_id:string;nombre:string;activo:boolean};
type CargoOption={id:string;nombre:string;activo:boolean};
type Row=Record<string,unknown>&{id:string;activo:boolean;puede_eliminar?:boolean;puede_cambiar_cliente?:boolean};
type Assignment={id:string;cliente_id:string;cliente:string;puesto?:string|null;renovacion:PrendaRenovacion;genero:GarmentGender;cantidad:number;activo:boolean};
type PendingAction={kind:"toggle"|"delete";row:Row};
// Filtros de Prendas (cliente "SIN" = prendas sin asignar). Cliente, puesto, género y renovación se aplican a las asignaciones.
const DEFAULT_PF={cliente:"",puesto:"",genero:"",renovacion:"",almacen:"",estado:"activas" as PrendasFilters["estado"]};
const empty:CatalogResult={rows:[],total:0,page:1,pageSize:50};
const singular:Record<CatalogKind,string>={clientes:"cliente",unidades:"unidad",personal:"persona",prendas:"prenda",provincias:"provincia",puestos:"puesto",cargos:"cargo"};
// Concordancia de género del sustantivo singular ("creado"/"creada"): antes solo existía la
// forma masculina y "unidad/persona/prenda" (femeninos) ya la mostraban mal; se corrige aquí.
const genero:Record<CatalogKind,"o"|"a"> = {clientes:"o",unidades:"a",personal:"a",prendas:"a",provincias:"a",puestos:"o",cargos:"o"};
function value(row:Row,key:string){const result=row[key];return result===null||result===undefined||result===""?"—":String(result)}
// Una prenda (ficha) se guarda una vez; aquí se ve a qué clientes está asignada, por renovación y con su cantidad.
function Asignaciones({row}:{row:Row}){
  const items=(row.asignaciones as Assignment[]|undefined)??[];
  if(!items.length)return <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--warning)]"><span className="rounded-md border border-[var(--warning)] px-2 py-0.5 font-semibold">Sin asignar</span>No se ofrece a ningún cliente. Ábrela con Editar para asignarla.</p>;
  return <ul aria-label="Asignaciones" className="mt-2 flex flex-wrap gap-1.5">{items.map(item=><li key={item.id} className={"rounded-md border px-2 py-0.5 text-xs "+(item.activo?"border-[var(--border)] bg-[var(--brand-50)]":"border-dashed text-[var(--text-secondary)] line-through")}>{item.cliente}{item.puesto?" · "+item.puesto:""} · {renovacionLabel(item.renovacion)} · {genderLabel(item.genero)} · ×{item.cantidad}{item.activo?"":" · inactiva"}</li>)}</ul>;
}
function recordName(catalog:CatalogKind,row:Row){return catalog==="prendas"?value(row,"nombre_prenda"):value(row,"nombre")}

function RowMenu({catalog,row,onEdit,onToggle,onDelete}:{catalog:CatalogKind;row:Row;onEdit:()=>void;onToggle:()=>void;onDelete:()=>void}){
  const closable=(callback:()=>void)=>(event:React.MouseEvent<HTMLButtonElement>)=>{event.currentTarget.closest("details")?.removeAttribute("open");callback()};
  return <details className="relative">
    <summary aria-label={"Acciones de "+recordName(catalog,row)} className="btn btn-ghost list-none !min-h-10 !px-2.5 [&::-webkit-details-marker]:hidden"><EllipsisVertical size={19}/></summary>
    <div role="menu" className="absolute right-0 top-11 z-20 w-56 rounded-xl border border-[var(--border)] bg-white p-1.5 shadow-[0_12px_32px_rgba(11,31,58,.14)]">
      <button role="menuitem" className="w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-[var(--brand-50)]" onClick={closable(onEdit)}>Editar</button>
      <button role="menuitem" className="w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-[var(--brand-50)]" onClick={closable(onToggle)}>{row.activo?"Desactivar":"Activar"}</button>
      {(catalog==="clientes"||catalog==="unidades")&&(row.puede_eliminar?
        <button role="menuitem" className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-[var(--error)] hover:bg-red-50" onClick={closable(onDelete)}>Eliminar definitivamente</button>:
        <p className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--text-secondary)]">Tiene información asociada; solo puede desactivarse.</p>)}
    </div>
  </details>;
}

export function AdminMaintenance({clients,esSuperadmin=false}:{clients:Client[];esSuperadmin?:boolean}){
  const [catalog,setCatalog]=useState<CatalogKind>("clientes"),[query,setQuery]=useState(""),[client,setClient]=useState(""),[pf,setPf]=useState(DEFAULT_PF),[almacenes,setAlmacenes]=useState<string[]>([]);
  const [clientOptions,setClientOptions]=useState(clients),[puestoOptions,setPuestoOptions]=useState<PuestoOption[]>([]),[cargoOptions,setCargoOptions]=useState<CargoOption[]>([]),[result,setResult]=useState(empty),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const [editor,setEditor]=useState<{row:Row|null}|null>(null),[dialogError,setDialogError]=useState(""),[pending,setPending]=useState<PendingAction|null>(null),[busy,setBusy]=useState(false),[toast,setToast]=useState(""),[dialogExisting,setDialogExisting]=useState("");
  const abort=useRef<AbortController|null>(null);
  const load=useCallback(async(page=1)=>{abort.current?.abort();const controller=new AbortController();abort.current=controller;setLoading(true);setError("");try{const params=catalog==="prendas"?prendasFilterParams({q:query,cliente:pf.cliente==="SIN"?"":pf.cliente,sinAsignar:pf.cliente==="SIN"?"1":"",puesto:pf.puesto,genero:pf.genero,renovacion:pf.renovacion,almacen:pf.almacen,estado:pf.estado}):new URLSearchParams({q:query});params.set("catalogo",catalog);params.set("page",String(page));if(catalog!=="prendas"&&client)params.set("cliente",client);const response=await fetch("/api/admin/catalogos?"+params,{cache:"no-store",signal:controller.signal});const data=await response.json();if(!response.ok)throw new Error(data.error);setResult(data);if(Array.isArray(data.almacenes))setAlmacenes(data.almacenes);}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"No se pudo consultar el catálogo.");}finally{if(abort.current===controller)setLoading(false)}},[catalog,query,client,pf]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(1),query?250:0);return()=>{window.clearTimeout(timer);abort.current?.abort()}},[load,query]);
  // Puestos de todos los clientes, para elegirlos al asignar una prenda (se leen todas las páginas).
  const loadPuestos=useCallback(async()=>{
    const rows:PuestoOption[]=[];
    for(let page=1;page<=40;page++){const response=await fetch("/api/admin/catalogos?catalogo=puestos&page="+page,{cache:"no-store"});if(!response.ok)return;const data=await response.json() as CatalogResult;rows.push(...(data.rows as unknown as PuestoOption[]));if(page*data.pageSize>=data.total)break}
    setPuestoOptions(rows);
  },[]);
  // Cargos (para elegir el cargo de una persona): se leen todas las páginas.
  const loadCargos=useCallback(async()=>{
    const rows:CargoOption[]=[];
    for(let page=1;page<=40;page++){const response=await fetch("/api/admin/catalogos?catalogo=cargos&page="+page,{cache:"no-store"});if(!response.ok)return;const data=await response.json() as CatalogResult;rows.push(...(data.rows as unknown as CargoOption[]));if(page*data.pageSize>=data.total)break}
    setCargoOptions(rows);
  },[]);
  useEffect(()=>{const timer=window.setTimeout(()=>void loadCargos(),0);return()=>window.clearTimeout(timer)},[loadCargos]);
  useEffect(()=>{if(!clientOptions.some(item=>item.diferencia_puestos))return;const timer=window.setTimeout(()=>void loadPuestos(),0);return()=>window.clearTimeout(timer)},[loadPuestos,clientOptions]);
  function changeCatalog(next:CatalogKind){setCatalog(next);setQuery("");setClient("");setPf(DEFAULT_PF);setResult(empty);setEditor(null);setPending(null)}
  function syncClient(row:Row,remove=false){if(catalog!=="clientes")return;setClientOptions(current=>remove?current.filter(item=>item.id!==row.id):[...current.filter(item=>item.id!==row.id),{id:row.id,nombre:value(row,"nombre"),activo:row.activo,diferencia_puestos:row.diferencia_puestos===true}].sort((a,b)=>a.nombre.localeCompare(b.nombre,"es")))}
  async function save(values:Record<string,unknown>){
    if(!editor||busy)return;setBusy(true);setDialogError("");setDialogExisting("");
    try{const editing=Boolean(editor.row);const response=await fetch("/api/admin/catalogos",{method:editing?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({catalogo:catalog,...(editing?{id:editor.row?.id}:{}),valores:values})});const data=await response.json();if(!response.ok){if(typeof data.existing_id==="string")setDialogExisting(data.existing_id);throw new Error(data.error)}syncClient(data.row as Row);if(catalog==="puestos")void loadPuestos();if(catalog==="cargos")void loadCargos();setEditor(null);setToast(singular[catalog][0].toUpperCase()+singular[catalog].slice(1)+" "+(editing?"actualizad":"cread")+genero[catalog]+" correctamente");await load(result.page);}catch(e){setDialogError(e instanceof Error?e.message:"No se pudo guardar el registro.");}finally{setBusy(false)}
  }
  // "Ya existe": abre la ficha de la prenda existente (para editarla o asignarla) y la deja visible en la lista.
  async function openExisting(id:string,code:string){
    try{const response=await fetch("/api/admin/catalogos?"+new URLSearchParams({catalogo:"prendas",q:code,estado:"todas",page:"1"}),{cache:"no-store"});const data=await response.json() as CatalogResult;const row=(data.rows as Row[]).find(item=>item.id===id);if(!response.ok||!row)throw new Error();setQuery(code);setPf(DEFAULT_PF);setPf(current=>({...current,estado:"todas"}));setDialogError("");setDialogExisting("");setEditor({row})}
    catch{setDialogError("No se pudo abrir la prenda existente. Búscala por su código en la lista.")}
  }
  async function confirm(){
    if(!pending||busy)return;setBusy(true);setError("");
    try{const deleting=pending.kind==="delete";const response=await fetch("/api/admin/catalogos",{method:deleting?"DELETE":"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(deleting?{catalogo:catalog,id:pending.row.id}:{catalogo:catalog,id:pending.row.id,activo:!pending.row.activo})});const data=await response.json();if(!response.ok)throw new Error(data.error);if(deleting)syncClient(pending.row,true);else syncClient(data as Row);if(catalog==="puestos")void loadPuestos();if(catalog==="cargos")void loadCargos();setPending(null);setToast(deleting?"Registro eliminado definitivamente":"Registro "+((data as Row).activo?"activado":"desactivado")+" correctamente");await load(result.page);}catch(e){setError(e instanceof Error?e.message:"No se pudo completar la operación.");setPending(null);}finally{setBusy(false)}
  }
  const usesPuestosFilter=pf.cliente!==""&&pf.cliente!=="SIN"&&clientOptions.find(item=>item.id===pf.cliente)?.diferencia_puestos===true;
  const filtersActive=Boolean(query||client||(catalog==="prendas"&&JSON.stringify(pf)!==JSON.stringify(DEFAULT_PF)));
  function clearFilters(){setQuery("");setClient("");setPf(DEFAULT_PF)}
  const rows=result.rows as Row[],pages=Math.max(1,Math.ceil(result.total/result.pageSize));
  const fields=catalog==="clientes"?["nombre","diferencia_puestos"]:catalog==="provincias"?["nombre"]:catalog==="cargos"?["nombre","personas"]:catalog==="puestos"?["nombre","clientes"]:catalog==="unidades"?["nombre","clientes","renovacion_defecto"]:catalog==="personal"?["codigo_personal","nombre","dni","cargo"]:["codigo_prenda","nombre_prenda","codigo_almacen","precio"];
  const label:Record<string,string>={nombre:"Nombre",clientes:"Cliente",codigo_personal:"Código",dni:"DNI",cargo:"Cargo",codigo_prenda:"Código",nombre_prenda:"Prenda",codigo_almacen:"Almacén",cliente:"Cliente",genero:"Género",renovacion:"Renovación",renovacion_defecto:"Renovación por defecto",diferencia_puestos:"Diferencia por puesto",personas:"Personas",cantidad:"Cant.",precio:"Precio"};
  return <section className="min-w-0"><AdminSectionNav/><header className="page-header"><p className="page-eyebrow">Administración</p><h1 className="page-title">Mantenimiento</h1><p className="page-description">Gestiona catálogos operativos sin alterar los requerimientos históricos.</p></header>
    <div className="card p-4 sm:p-5">
      <div role="tablist" aria-label="Catálogos" className="flex gap-1 overflow-x-auto border-b border-[var(--border)]">{catalogs.map(item=><button key={item.id} role="tab" aria-selected={catalog===item.id} className={"min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium "+(catalog===item.id?"border-[var(--brand-600)] text-[var(--brand-700)]":"border-transparent text-[var(--text-secondary)]")} onClick={()=>changeCatalog(item.id)}>{item.label}</button>)}</div>
      <div className="mt-4 grid gap-3">
        <div className="relative"><Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"/><input aria-label={"Buscar en "+catalog} className="input w-full !pl-10" maxLength={120} value={query} onChange={event=>setQuery(event.target.value)} placeholder={catalog==="prendas"?"Buscar por código o nombre de prenda":"Buscar por nombre o código"}/></div>
        {(catalog==="unidades"||catalog==="puestos")&&<div className="sm:max-w-xs"><select aria-label="Filtrar por cliente" className="input" value={client} onChange={event=>setClient(event.target.value)}><option value="">Todos los clientes</option>{clientOptions.map(item=><option key={item.id} value={item.id}>{item.nombre}</option>)}</select></div>}
        {catalog==="prendas"&&<div data-testid="filtros-prendas" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <label className="min-w-0"><span className="label">Cliente</span><select aria-label="Filtrar por cliente" className="input" value={pf.cliente} onChange={event=>setPf({...pf,cliente:event.target.value,puesto:"",...(event.target.value==="SIN"?{genero:"",renovacion:""}:{})})}><option value="">Todos los clientes</option>{clientOptions.map(item=><option key={item.id} value={item.id}>{item.nombre}</option>)}<option value="SIN">Sin asignar</option></select></label>
          <label className="min-w-0"><span className="label">Puesto</span><select aria-label="Filtrar por puesto" className="input" value={pf.puesto} disabled={!usesPuestosFilter} onChange={event=>setPf({...pf,puesto:event.target.value})}><option value="">{usesPuestosFilter?"Todos los puestos":"No aplica"}</option>{puestoOptions.filter(item=>item.cliente_id===pf.cliente).map(item=><option key={item.id} value={item.id}>{item.nombre}</option>)}</select></label>
          <label className="min-w-0"><span className="label">Género</span><select aria-label="Filtrar por género" className="input" value={pf.genero} disabled={pf.cliente==="SIN"} onChange={event=>setPf({...pf,genero:event.target.value})}><option value="">Todos los géneros</option><option value="HOMBRE">Hombre</option><option value="MUJER">Mujer</option><option value="AMBOS">Ambos</option></select></label>
          <label className="min-w-0"><span className="label">Renovación</span><select aria-label="Filtrar por renovación" className="input" value={pf.renovacion} disabled={pf.cliente==="SIN"} onChange={event=>setPf({...pf,renovacion:event.target.value})}><option value="">Todas las renovaciones</option><option value="VERANO">Verano</option><option value="INVIERNO">Invierno</option><option value="AMBOS">Ambos</option></select></label>
          <label className="min-w-0"><span className="label">Almacén</span><select aria-label="Filtrar por almacén" className="input" value={pf.almacen} onChange={event=>setPf({...pf,almacen:event.target.value})}><option value="">Todos los almacenes</option>{almacenes.map(code=><option key={code} value={code}>{code}</option>)}</select></label>
          <label className="min-w-0"><span className="label">Estado</span><select aria-label="Filtrar por estado" className="input" value={pf.estado} onChange={event=>setPf({...pf,estado:event.target.value as PrendasFilters["estado"]})}><option value="activas">Activas</option><option value="inactivas">Inactivas</option><option value="todas">Todas</option></select></label>
        </div>}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-ghost w-full sm:w-auto" disabled={!filtersActive} onClick={clearFilters}><RotateCcw size={16}/>Limpiar filtros</button>
          {catalog==="prendas"&&<a className="btn btn-secondary w-full sm:w-auto" href={"/api/admin/prendas/exportar?"+prendasFilterParams({q:query,cliente:pf.cliente==="SIN"?"":pf.cliente,sinAsignar:pf.cliente==="SIN"?"1":"",puesto:pf.puesto,genero:pf.genero,renovacion:pf.renovacion,almacen:pf.almacen,estado:pf.estado})} download><Download size={17}/>Exportar prendas</a>}
          <button className="btn btn-primary w-full sm:w-auto" onClick={()=>{setDialogError("");setDialogExisting("");setEditor({row:null})}}><Plus size={17}/>Nuevo</button>
        </div>
      </div>
    </div>
    {error&&<div className="mt-4"><Alert kind="error">{error}</Alert></div>}
    <div className="mt-4 flex min-h-6 items-center justify-between"><h2 className="text-sm font-semibold text-[var(--brand-900)]">{result.total.toLocaleString("es-PE")} registros</h2>{loading&&<span className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"><LoaderCircle size={15} className="animate-spin"/>Consultando…</span>}</div>
    <div className={"card mt-3 overflow-visible "+(loading?"opacity-60":"")}>{!loading&&!rows.length?<p className="px-4 py-7 text-center text-sm text-[var(--text-secondary)]">No hay registros con estos filtros.</p>:<div className="divide-y divide-[var(--border)]">{rows.map(row=><article key={row.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"><div className="min-w-0"><dl className={"grid min-w-0 gap-x-5 gap-y-2 "+(fields.length>2?"sm:grid-cols-2 xl:grid-cols-4":"sm:grid-cols-2")}>{fields.map(field=>{const raw=field==="clientes"?(row.clientes as {nombre?:string})?.nombre:field==="diferencia_puestos"?(row.diferencia_puestos?"Sí":"No"):value(row,field);return <div key={field} className="min-w-0"><dt className="text-xs text-[var(--text-secondary)]">{label[field]}</dt><dd className="mt-0.5 break-words text-sm font-medium">{field==="precio"?"S/ "+Number(raw).toFixed(2):String(raw??"—")}</dd></div>})}</dl>{catalog==="prendas"&&<Asignaciones row={row}/>}</div><div className="flex items-center justify-between gap-3 lg:justify-end"><span className={"text-xs font-semibold "+(row.activo?"text-[var(--success)]":"text-[var(--text-secondary)]")}>{row.activo?"Activo":"Inactivo"}</span><RowMenu catalog={catalog} row={row} onEdit={()=>{setDialogError("");setEditor({row})}} onToggle={()=>setPending({kind:"toggle",row})} onDelete={()=>setPending({kind:"delete",row})}/></div></article>)}</div>}</div>
    <nav aria-label="Paginación del catálogo" className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-[var(--text-secondary)]">Página {result.page} de {pages}</p><div className="flex gap-2"><button className="btn btn-secondary" disabled={loading||result.page<=1} onClick={()=>void load(result.page-1)}>Anterior</button><button className="btn btn-secondary" disabled={loading||result.page>=pages} onClick={()=>void load(result.page+1)}>Siguiente</button></div></nav>
    {editor&&<AdminCatalogDialog key={catalog+"-"+(editor.row?.id??"new")} esSuperadmin={esSuperadmin} catalog={catalog} row={editor.row} clients={clientOptions} puestos={puestoOptions} cargos={cargoOptions} busy={busy} error={dialogError} existingId={dialogExisting} onOpenExisting={openExisting} onCancel={()=>{if(!busy)setEditor(null)}} onSubmit={save}/>}
    <ConfirmDialog open={Boolean(pending)} busy={busy} intent={pending?.kind==="delete"?"danger":"warning"} context={pending?.kind==="delete"?"delete":"logout"} title={pending?.kind==="delete"?"¿Eliminar definitivamente este "+singular[catalog]+"?":pending?.row.activo?"¿Desactivar este registro?":"¿Activar este registro?"} description={pending?.kind==="delete"?(catalog==="clientes"?"Este cliente no tiene información asociada y será eliminado definitivamente. ¿Deseas continuar?":"Esta unidad nunca fue utilizada y será eliminada definitivamente. ¿Deseas continuar?"):"El cambio afectará los formularios nuevos, pero los requerimientos históricos conservarán sus datos."} confirmLabel={pending?.kind==="delete"?"Sí, eliminar definitivamente":pending?.row.activo?"Sí, desactivar":"Sí, activar"} onCancel={()=>setPending(null)} onConfirm={confirm}/>
    <Toast message={toast} onClose={()=>setToast("")}/>
  </section>;
}
