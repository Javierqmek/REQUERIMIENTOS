"use client";
import { useEffect,useRef,useState } from "react";
import { Eraser,PenLine,Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { Alert } from "./ui/alert";

export function SignatureProfileForm({initialName,initialRole,configured}:{initialName:string;initialRole:string;configured:boolean}){
 const canvasRef=useRef<HTMLCanvasElement>(null);const drawing=useRef(false);const [file,setFile]=useState<File|null>(null);const [name,setName]=useState(initialName);const [role,setRole]=useState(initialRole);const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const router=useRouter();
 useEffect(()=>{const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext("2d");if(!ctx)return;ctx.lineCap="round";ctx.lineJoin="round";ctx.strokeStyle="#0B1F3A";ctx.lineWidth=2.4;},[]);
 function point(e:React.PointerEvent<HTMLCanvasElement>){const rect=e.currentTarget.getBoundingClientRect();return{x:(e.clientX-rect.left)*e.currentTarget.width/rect.width,y:(e.clientY-rect.top)*e.currentTarget.height/rect.height}}
 function start(e:React.PointerEvent<HTMLCanvasElement>){drawing.current=true;e.currentTarget.setPointerCapture(e.pointerId);const p=point(e);canvasRef.current?.getContext("2d")?.beginPath();canvasRef.current?.getContext("2d")?.moveTo(p.x,p.y)}
 function move(e:React.PointerEvent<HTMLCanvasElement>){if(!drawing.current)return;const p=point(e);const ctx=canvasRef.current?.getContext("2d");ctx?.lineTo(p.x,p.y);ctx?.stroke()}
 function clear(){canvasRef.current?.getContext("2d")?.clearRect(0,0,800,260);setFile(null)}
 async function save(){
  setBusy(true);setMessage("");try{const form=new FormData();form.set("nombre",name);form.set("cargo",role);
   if(file)form.set("firma",file);else{const blob=await new Promise<Blob|null>(resolve=>canvasRef.current?.toBlob(resolve,"image/png"));if(blob&&await hasInk(blob))form.set("firma",new File([blob],"firma.png",{type:"image/png"}));}
   const response=await fetch("/api/perfil/firma",{method:"POST",body:form});const data=await response.json();if(!response.ok)throw new Error(data.error);setMessage("Perfil de firma actualizado.");router.refresh();
  }catch(error){setMessage(error instanceof Error?error.message:"No se pudo guardar.");}finally{setBusy(false)}
 }
 async function hasInk(blob:Blob){const data=new Uint8Array(await blob.arrayBuffer());return data.length>1000}
 return <div className="grid gap-5 lg:grid-cols-[1fr_360px]"><section className="section-card"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-lg bg-[#EAF2FF] text-[#174EA6]"><PenLine size={20}/></span><div><h2 className="section-title">Firma manuscrita</h2><p className="metadata">Dibuja con mouse o pantalla táctil, o carga un PNG/WebP transparente.</p></div></div>
  <div className="mt-4 overflow-hidden rounded-xl border border-[#CBD5E1] bg-white"><canvas ref={canvasRef} width={800} height={260} className="block h-48 w-full touch-none cursor-crosshair" onPointerDown={start} onPointerMove={move} onPointerUp={()=>drawing.current=false} onPointerCancel={()=>drawing.current=false} aria-label="Área para dibujar la firma"/></div>
  <div className="mt-3 flex flex-wrap gap-2"><label className="btn btn-secondary cursor-pointer"><Upload size={17}/>Cargar imagen<input className="sr-only" type="file" accept="image/png,image/webp" onChange={e=>setFile(e.target.files?.[0]||null)}/></label><button type="button" onClick={clear} className="btn btn-ghost"><Eraser size={17}/>Limpiar</button>{file&&<span className="self-center text-xs text-[#607089]">{file.name}</span>}</div>
 </section><aside className="section-card"><h2 className="section-title">Sello corporativo</h2><p className="mt-1 text-sm text-[#607089]">Se genera como imagen independiente con identidad Seguroc.</p><label className="label mt-5">Nombre visible</label><input className="input" maxLength={160} value={name} onChange={e=>setName(e.target.value)}/><label className="label mt-4">Cargo</label><input className="input" maxLength={120} value={role} onChange={e=>setRole(e.target.value)}/>
 <div className="mt-5 rounded-xl border-2 border-[#0B1F3A] p-4 text-center text-[#0B1F3A]"><strong className="block text-lg tracking-wide">SEGUROC</strong><span className="mt-2 block border-t border-[#0B1F3A] pt-2 text-sm font-semibold">{name||"Nombre"}</span><span className="block text-xs text-[#174EA6]">{role||"Cargo"}</span></div>
 {message&&<div className="mt-4"><Alert kind={message.includes("actualizado")?"success":"error"}>{message}</Alert></div>}<button disabled={busy} onClick={save} className="btn btn-primary mt-5 w-full">{busy?"Guardando…":configured?"Actualizar perfil":"Guardar perfil"}</button></aside></div>
}
