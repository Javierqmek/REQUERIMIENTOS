"use client";
import Image from "next/image";
import { useEffect,useRef,useState } from "react";
import { Eraser,ImageUp,PenLine,RefreshCw,ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { Alert } from "./ui/alert";
import { CorporateStampPreview } from "./corporate-stamp-preview";

export function SignatureProfileForm({initialName,initialRole,configured,hasSignature=configured,updatedAt}:{initialName:string;initialRole:string;configured:boolean;hasSignature?:boolean;updatedAt?:string|null}){
 const canvasRef=useRef<HTMLCanvasElement>(null);const drawing=useRef(false);const ink=useRef(false);const objectUrl=useRef<string|null>(null);
 const [file,setFile]=useState<File|null>(null);const [preview,setPreview]=useState<string|null>(hasSignature?"/api/perfil/firma?tipo=firma":null);const [name,setName]=useState(initialName);const [role,setRole]=useState(initialRole);const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const router=useRouter();
 useEffect(()=>{const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext("2d");if(!ctx)return;ctx.lineCap="round";ctx.lineJoin="round";ctx.strokeStyle="#0B1F3A";ctx.lineWidth=2.4;return()=>{if(objectUrl.current)URL.revokeObjectURL(objectUrl.current)}},[]);
 function point(e:React.PointerEvent<HTMLCanvasElement>){const rect=e.currentTarget.getBoundingClientRect();return{x:(e.clientX-rect.left)*e.currentTarget.width/rect.width,y:(e.clientY-rect.top)*e.currentTarget.height/rect.height}}
 function start(e:React.PointerEvent<HTMLCanvasElement>){drawing.current=true;ink.current=true;setFile(null);e.currentTarget.setPointerCapture(e.pointerId);const p=point(e);const ctx=canvasRef.current?.getContext("2d");ctx?.beginPath();ctx?.moveTo(p.x,p.y)}
 function move(e:React.PointerEvent<HTMLCanvasElement>){if(!drawing.current)return;const p=point(e);const ctx=canvasRef.current?.getContext("2d");ctx?.lineTo(p.x,p.y);ctx?.stroke()}
 function finish(){drawing.current=false;if(ink.current)setPreview(canvasRef.current?.toDataURL("image/png")||null)}
 function clear(){canvasRef.current?.getContext("2d")?.clearRect(0,0,800,260);ink.current=false;setFile(null);setPreview(hasSignature?"/api/perfil/firma?tipo=firma":null)}
 function choose(next:File|null){if(!next)return;if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);objectUrl.current=URL.createObjectURL(next);setFile(next);setPreview(objectUrl.current);ink.current=false}
 async function save(){
  setBusy(true);setMessage("");try{const form=new FormData();form.set("nombre",name);form.set("cargo",role);
   if(file)form.set("firma",file);else if(ink.current){const blob=await new Promise<Blob|null>(resolve=>canvasRef.current?.toBlob(resolve,"image/png"));if(blob)form.set("firma",new File([blob],"firma.png",{type:"image/png"}));}
   const response=await fetch("/api/perfil/firma",{method:"POST",body:form});const data=await response.json();if(!response.ok)throw new Error(data.error);setMessage("Perfil de firma actualizado.");setPreview(`/api/perfil/firma?tipo=firma&v=${Date.now()}`);router.refresh();
  }catch(error){setMessage(error instanceof Error?error.message:"No se pudo guardar.");}finally{setBusy(false)}
 }
 return <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]"><section className="section-card"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#EAF2FF] text-[#174EA6]"><PenLine size={18}/></span><div><h2 className="section-title">Firma manuscrita</h2><p className="metadata mt-1">Dibuja tu firma o carga un PNG/WebP con fondo transparente.</p></div></div>
  {hasSignature&&<div className="mt-4 rounded-lg border border-[#DCE3EC] bg-[#F8FAFC] p-3"><p className="label mb-2">Firma vigente</p><div className="relative h-24 rounded-md bg-white"><Image unoptimized fill src="/api/perfil/firma?tipo=firma" alt="Firma manuscrita vigente" className="object-contain"/></div></div>}
  <div className="mt-4 overflow-hidden rounded-xl border border-[#CBD5E1] bg-white"><canvas ref={canvasRef} width={800} height={260} className="block h-44 w-full touch-none cursor-crosshair" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} aria-label="Área para dibujar la firma"/></div>
  <div className="mt-3 flex flex-wrap gap-2"><label className="btn btn-secondary cursor-pointer"><ImageUp size={17}/>{configured?"Reemplazar con imagen":"Subir firma PNG"}<input className="sr-only" type="file" accept="image/png,image/webp" onChange={e=>choose(e.target.files?.[0]||null)}/></label><button type="button" onClick={clear} className="btn btn-ghost"><Eraser size={17}/>Limpiar dibujo</button>{file&&<span className="self-center truncate text-xs text-[#607089]">{file.name}</span>}</div>
  <div className="mt-6 grid gap-4 border-t border-[#DCE3EC] pt-5 sm:grid-cols-2"><div><label className="label">Nombre visible</label><input className="input" maxLength={160} value={name} onChange={e=>setName(e.target.value)}/></div><div><label className="label">Cargo</label><input className="input" maxLength={120} value={role} onChange={e=>setRole(e.target.value)}/></div></div>
 </section><aside className="section-card h-fit"><div className="flex items-center justify-between gap-3"><div><h2 className="section-title">Vista previa del sello</h2><p className="metadata mt-1">Plantilla corporativa fija</p></div><ShieldCheck size={20} className="text-[#16803C]"/></div>
 <div className="stamp-preview-grid mt-4 rounded-xl"><CorporateStampPreview name={name} role={role} signatureSrc={preview}/></div>
 <div className="mt-3 flex items-start gap-2 text-xs text-[#607089]"><RefreshCw size={14} className="mt-0.5 shrink-0"/><p>El logo, la firma, el nombre y el cargo se componen automáticamente. No se puede alterar la plantilla.</p></div>
 {updatedAt&&<p className="mt-3 text-xs text-[#607089]">Última actualización: {new Intl.DateTimeFormat("es-PE",{dateStyle:"medium",timeStyle:"short"}).format(new Date(updatedAt))}</p>}
 {message&&<div className="mt-4"><Alert kind={message.includes("actualizado")?"success":"error"}>{message}</Alert></div>}<button disabled={busy} onClick={save} className="btn btn-primary mt-5 w-full">{busy?"Guardando…":configured?"Actualizar perfil":"Guardar perfil"}</button></aside></div>
}
