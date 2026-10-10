"use client";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Plus, Trash2, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import type { CatalogKind } from "@/lib/admin/maintenance";
import type { Alcance, Impacto } from "@/lib/admin/prendas-import";

type Row = Record<string, unknown> & { id: string; activo: boolean };
type Assign = { key: string; id?: string; cliente_id: string; renovacion: string; genero: string; cantidad: string; activo: boolean };
let assignSequence = 0;
type ClientOption = { id: string; nombre: string; activo: boolean };
const names: Record<CatalogKind,string> = {
  clientes:"cliente", unidades:"unidad", personal:"persona", prendas:"prenda", provincias:"provincia",
};
function text(row:Row|null,key:string){return row?.[key]===undefined||row?.[key]===null?"":String(row[key])}
function Field({label,name,defaultValue="",maxLength,type="text",readOnly=false,min,max,step,inputMode,pattern,title}:{inputMode?:"numeric";pattern?:string;title?:string;label:string;name:string;defaultValue?:string;maxLength?:number;type?:string;readOnly?:boolean;min?:number;max?:number;step?:number}){
  return <label><span className="label">{label}</span><input className="input" name={name} type={type} maxLength={maxLength} defaultValue={defaultValue} readOnly={readOnly} inputMode={inputMode} pattern={pattern} title={title} min={min} max={max} step={step} required/></label>;
}
export function AdminCatalogDialog({catalog,row,clients,busy,error,esSuperadmin=false,onCancel,onSubmit}:{
  catalog:CatalogKind; row:Row|null; clients:ClientOption[]; busy:boolean; error:string; esSuperadmin?:boolean;
  onCancel:()=>void; onSubmit:(values:Record<string,unknown>)=>void;
}){
  const cancelRef=useRef<HTMLButtonElement>(null),editing=Boolean(row),currentClientId=catalog==="unidades"?text(row,"cliente_id"):clients.find(c=>c.nombre===text(row,"cliente"))?.id??"";
  const selectableClients=clients.filter(c=>c.activo||c.id===currentClientId);
  const [assigns,setAssigns]=useState<Assign[]>(()=>catalog==="prendas"?(((row?.asignaciones as {id:string;cliente_id:string;renovacion:string;genero:string;cantidad:number;activo:boolean}[]|undefined)??[]).map(a=>({key:a.id,id:a.id,cliente_id:a.cliente_id,renovacion:a.renovacion,genero:a.genero,cantidad:String(a.cantidad),activo:a.activo}))):[]);
  // Cambiar el precio o el código de almacén: las líneas de requerimientos guardan una copia; se pide el alcance.
  const [pending,setPending]=useState<{values:Record<string,unknown>;impact:Impacto}|null>(null),[scope,setScope]=useState<Alcance>("ahora"),[checking,setChecking]=useState(false),[checkError,setCheckError]=useState("");
  const patchAssign=(key:string,patch:Partial<Assign>)=>setAssigns(current=>current.map(a=>a.key===key?{...a,...patch}:a));
  useEffect(()=>{cancelRef.current?.focus();const close=(event:KeyboardEvent)=>{if(event.key==="Escape"&&!busy)onCancel()};document.addEventListener("keydown",close);return()=>document.removeEventListener("keydown",close)},[busy,onCancel]);
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(pending){onSubmit({...pending.values,alcance:scope});return}
    const data=new FormData(event.currentTarget);
    const common=Object.fromEntries(data.entries()) as Record<string,unknown>;
    if(catalog==="prendas"){common.precio=Number(common.precio);common.asignaciones=assigns.map(a=>({...(a.id?{id:a.id}:{}),cliente_id:a.cliente_id,renovacion:a.renovacion,genero:a.genero,cantidad:Number(a.cantidad),activo:a.activo}))}
    if(catalog==="prendas"&&editing&&(Number(common.precio)!==Number(row?.precio)||String(common.codigo_almacen).trim()!==text(row,"codigo_almacen"))){
      setChecking(true);setCheckError("");
      try{
        const response=await fetch("/api/admin/prendas/impacto",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:row?.id,precio:Number(common.precio),codigo_almacen:String(common.codigo_almacen).trim()})});
        const impact=await response.json();if(!response.ok)throw new Error(impact.error);
        if((impact as Impacto).todos.lineas>0){setScope("ahora");setPending({values:common,impact});return}
      }catch(e){setCheckError(e instanceof Error?e.message:"No se pudo calcular el impacto del cambio.");return}finally{setChecking(false)}
    }
    onSubmit(common);
  }
  const changes=pending?[pending.impact.precio_cambia&&"el precio",pending.impact.almacen_cambia&&"el código de almacén"].filter(Boolean).join(" y "):"";
  return <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#0B1F3A]/40 p-4" role="presentation" onMouseDown={event=>{if(event.currentTarget===event.target&&!busy)onCancel()}}>
    <section role="dialog" aria-modal="true" aria-labelledby="catalog-dialog-title" className="my-auto w-full max-w-xl rounded-xl border border-[var(--border)] bg-white shadow-[0_18px_48px_rgba(11,31,58,.18)]">
      <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
        <div><p className="page-eyebrow">Mantenimiento</p><h2 id="catalog-dialog-title" className="mt-1 text-lg font-semibold text-[var(--brand-900)]">{editing?"Editar":"Nuevo"} {names[catalog]}</h2></div>
        <button className="btn btn-ghost !min-h-10 !px-2.5" aria-label="Cerrar formulario" disabled={busy} onClick={onCancel}><X size={18}/></button>
      </header>
      <form onSubmit={submit}>
        {pending&&<div className="grid max-h-[65vh] gap-3 overflow-y-auto px-5 py-5" data-testid="alcance">
          <div><h3 className="text-base font-semibold text-[var(--brand-900)]">¿Desde cuándo aplica el cambio de {changes}?</h3><p className="mt-1 text-xs text-[var(--text-secondary)]">Las líneas de requerimiento guardan una copia del precio y del código de almacén al crearse. El nombre no se copia: su cambio se ve en todos los requerimientos.</p></div>
          {([["ahora","Solo desde ahora","Solo cambia la ficha. Los requerimientos existentes no cambian.",0,0],["tramite","También requerimientos en trámite",`Actualiza ${pending.impact.tramite.lineas} líneas en ${pending.impact.tramite.requerimientos} requerimientos Pendiente u Observado.`,pending.impact.tramite.lineas,pending.impact.tramite.requerimientos],["todos","Todos los requerimientos",`Actualiza ${pending.impact.todos.lineas} líneas en ${pending.impact.todos.requerimientos} requerimientos, incluidos los Atendidos. Puede no coincidir con lo ya cargado en SIDIGE.${esSuperadmin?"":" Solo un superadmin puede elegir esta opción."}`,pending.impact.todos.lineas,pending.impact.todos.requerimientos]] as const).map(([value,label,detail])=>
            <label key={value} className={"flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm "+(scope===value?"border-[var(--brand-600)] bg-[var(--brand-50)]":"border-[var(--border)]")+(value==="todos"&&!esSuperadmin?" opacity-60":"")}>
              <input type="radio" name="alcance" className="mt-1" checked={scope===value} disabled={value==="todos"&&!esSuperadmin} onChange={()=>setScope(value)}/>
              <span><strong className="font-medium">{label}</strong><span className="mt-0.5 block text-xs text-[var(--text-secondary)]">{detail}</span></span></label>)}
          {scope!=="ahora"&&<Alert kind="info">{scope==="tramite"?`Se modificarán ${pending.impact.tramite.lineas} líneas en ${pending.impact.tramite.requerimientos} requerimientos. Los totales se recalculan solos.`:`Se modificarán ${pending.impact.todos.lineas} líneas en ${pending.impact.todos.requerimientos} requerimientos, incluidos los ya atendidos.`} Cada cambio queda registrado con las líneas afectadas.</Alert>}
          {error&&<Alert kind="error">{error}</Alert>}
        </div>}
        <div className={"grid max-h-[65vh] gap-4 overflow-y-auto px-5 py-5 sm:grid-cols-2"+(pending?" hidden":"")}>
          {catalog==="clientes"&&<div className="sm:col-span-2"><Field label="Nombre del cliente" name="nombre" maxLength={200} defaultValue={text(row,"nombre")}/></div>}
          {catalog==="provincias"&&<div className="sm:col-span-2"><Field label="Nombre de la provincia" name="nombre" maxLength={200} defaultValue={text(row,"nombre")}/></div>}
          {catalog==="unidades"&&<>
            <label><span className="label">Cliente</span><select className="input" name="cliente_id" defaultValue={currentClientId} disabled={editing&&row?.puede_cambiar_cliente===false} required><option value="">Selecciona un cliente</option>{selectableClients.map(client=><option key={client.id} value={client.id}>{client.nombre}</option>)}</select>{editing&&row?.puede_cambiar_cliente===false&&<span className="mt-1.5 block text-xs text-[var(--text-secondary)]">No puede cambiar porque la unidad ya fue utilizada.</span>}{editing&&row?.puede_cambiar_cliente===false&&<input type="hidden" name="cliente_id" value={currentClientId}/>}</label>
            <Field label="Nombre de unidad / sede" name="nombre" maxLength={200} defaultValue={text(row,"nombre")}/>
            <label className="sm:col-span-2"><span className="label">Renovación por defecto</span><select className="input" name="renovacion_defecto" defaultValue={text(row,"renovacion_defecto")||"VERANO"} required><option value="VERANO">Verano</option><option value="INVIERNO">Invierno</option></select><span className="mt-1.5 block text-xs text-[var(--text-secondary)]">Se preselecciona al elegir esta unidad en un requerimiento; el usuario puede cambiarla.</span></label>
          </>}
          {catalog==="personal"&&<>
            <Field label="Código de personal" name="codigo_personal" maxLength={80} defaultValue={text(row,"codigo_personal")} readOnly={editing}/>
            <Field label="DNI" name="dni" maxLength={8} inputMode="numeric" pattern="[0-9]{8}" title="Exactamente 8 dígitos" defaultValue={text(row,"dni")} />
            <div className="sm:col-span-2"><Field label="Nombre completo" name="nombre" maxLength={200} defaultValue={text(row,"nombre")}/></div>
            <div className="sm:col-span-2"><Field label="Cargo" name="cargo" maxLength={120} defaultValue={text(row,"cargo")}/></div>
          </>}
          {catalog==="prendas"&&<>
            <Field label="Código de prenda" name="codigo_prenda" maxLength={80} defaultValue={text(row,"codigo_prenda")}/>
            <Field label="Código de almacén" name="codigo_almacen" maxLength={80} defaultValue={text(row,"codigo_almacen")}/>
            <div className="sm:col-span-2"><Field label="Nombre de la prenda" name="nombre_prenda" maxLength={240} defaultValue={text(row,"nombre_prenda")}/></div>
            <Field label="Precio unitario" name="precio" type="number" min={0} max={9999999999.99} step={0.01} defaultValue={text(row,"precio")} />
            <div className="sm:col-span-2" data-testid="asignaciones"><div className="flex items-center justify-between gap-2"><div><span className="label !mb-0">Asignaciones por cliente</span><span className="block text-xs text-[var(--text-secondary)]">El género y la cantidad dependen del cliente y la renovación. AMBOS no puede convivir con Verano o Invierno para el mismo cliente.</span></div><button type="button" className="btn btn-secondary !min-h-9 shrink-0" onClick={()=>setAssigns(current=>[...current,{key:"nueva-"+(++assignSequence),cliente_id:"",renovacion:"AMBOS",genero:"AMBOS",cantidad:"1",activo:true}])}><Plus size={15}/>Agregar asignación</button></div>
              {!assigns.length&&<p className="mt-2 text-xs text-[var(--warning)]">Sin asignaciones: la prenda no se ofrecerá a ningún cliente.</p>}
              <ul className="mt-2 grid gap-2">{assigns.map(a=><li key={a.key} className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--border)] p-2 sm:grid-cols-[minmax(0,1fr)_110px_110px_90px_auto_auto] sm:items-end">
                <label className="col-span-2 sm:col-span-1"><span className="label">Cliente</span><select aria-label="Cliente de la asignación" className="input" value={a.cliente_id} disabled={Boolean(a.id)} required onChange={e=>patchAssign(a.key,{cliente_id:e.target.value})}><option value="">Selecciona un cliente</option>{clients.filter(c=>c.activo||c.id===a.cliente_id).map(client=><option key={client.id} value={client.id}>{client.nombre}</option>)}</select></label>
                <label><span className="label">Renovación</span><select aria-label="Renovación de la asignación" className="input" value={a.renovacion} onChange={e=>patchAssign(a.key,{renovacion:e.target.value})}><option value="VERANO">Verano</option><option value="INVIERNO">Invierno</option><option value="AMBOS">Ambos</option></select></label>
                <label><span className="label">Género</span><select aria-label="Género de la asignación" className="input" value={a.genero} onChange={e=>patchAssign(a.key,{genero:e.target.value})}><option value="HOMBRE">Hombre</option><option value="MUJER">Mujer</option><option value="AMBOS">Ambos</option></select></label>
                <label><span className="label">Cantidad</span><input aria-label="Cantidad de la asignación" className="input" type="number" min={1} max={10000} step={1} required value={a.cantidad} onChange={e=>patchAssign(a.key,{cantidad:e.target.value})}/></label>
                <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={a.activo} onChange={e=>patchAssign(a.key,{activo:e.target.checked})}/>Activa</label>
                {!a.id&&<button type="button" aria-label="Quitar asignación" className="btn btn-ghost !px-2.5" onClick={()=>setAssigns(current=>current.filter(item=>item.key!==a.key))}><Trash2 size={16}/></button>}
              </li>)}</ul></div>
          </>}
          {(error||checkError)&&!pending&&<div className="sm:col-span-2"><Alert kind="error">{error||checkError}</Alert></div>}
        </div>
        <footer className="flex flex-col-reverse gap-2 border-t border-[var(--border)] bg-[var(--brand-50)] px-5 py-4 sm:flex-row sm:justify-end">
          {pending?<button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>setPending(null)}>Volver</button>:<button ref={cancelRef} type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancelar</button>}
          <button type="submit" className="btn btn-primary" disabled={busy||checking}>{(busy||checking)&&<LoaderCircle size={17} className="animate-spin"/>}{busy?"Guardando…":checking?"Calculando impacto…":pending?"Confirmar y guardar":editing?"Guardar cambios":"Crear registro"}</button>
        </footer>
      </form>
    </section>
  </div>;
}
