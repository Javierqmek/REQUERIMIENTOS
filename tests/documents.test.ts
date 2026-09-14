import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { degrees,PDFDict,PDFDocument,PDFName } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeCorporateStamp,normalizeImportedSignatureAsset,safePdfName,sha256,validatePdf } from "../lib/documents/security";
import { createSignedPdf } from "../lib/documents/pdf";
import { fitImageInPlacement,normalizePageRotation } from "../lib/documents/placement";
import { documentBasePath } from "../lib/documents/version";
import sharp from "sharp";

const asArrayBuffer=(bytes:Uint8Array)=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
test("normaliza nombres de PDF sin permitir rutas",()=>{assert.equal(safePdfName("../../contrato<script>.PDF"),"contratoscript.pdf")});
test("calcula SHA-256 estable",()=>{assert.equal(sha256(new TextEncoder().encode("Seguroc")),"2a5d76a49d8a4a199ca3ac8abfe45834a71633ee8bc0e9f903e0d17d8434a060")});
test("valida un PDF auténtico y cuenta páginas",async()=>{const pdf=await PDFDocument.create();pdf.addPage();pdf.addPage();const bytes=await pdf.save();const result=await validatePdf(new File([asArrayBuffer(bytes)],"prueba.pdf",{type:"application/pdf"}));assert.equal(result.pages,2);assert.equal(result.hash.length,64)});
test("rechaza contenido que solo declara MIME PDF",async()=>{await assert.rejects(()=>validatePdf(new File(["malicioso"],"falso.pdf",{type:"application/pdf"})),/PDF válido/)});
test("genera el sello corporativo como PNG",async()=>{const result=await makeCorporateStamp("Ana Pérez","Gerente");assert.deepEqual([...result.bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(result.hash.length,64)});
test("el sello corporativo es transparente hasta todos sus bordes y no dibuja marco",async()=>{const signature=await sharp({create:{width:220,height:70,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:Buffer.from('<svg width="220" height="70"><path d="M8 52 C55 4 110 68 210 14" fill="none" stroke="#17365d" stroke-width="6"/></svg>')}]).png().toBuffer();const result=await makeCorporateStamp("Ana Pérez","Gerente de Operaciones",signature);const {data,info}=await sharp(result.bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(info.width,900);assert.equal(info.height,340);const alpha=(x:number,y:number)=>data[(y*info.width+x)*4+3];for(let x=0;x<info.width;x++){assert.equal(alpha(x,0),0);assert.equal(alpha(x,info.height-1),0)}for(let y=0;y<info.height;y++){assert.equal(alpha(0,y),0);assert.equal(alpha(info.width-1,y),0)}assert.ok(data.some((value,index)=>index%4===3&&value>0));const source=await readFile("lib/documents/security.ts","utf8");assert.doesNotMatch(source,/<rect|stroke-width="14"|rx="28"/)});
test("ajusta firma y sello sin deformar dentro de coordenadas normalizadas",()=>{const rect=fitImageInPlacement({width:900,height:340},{width:600,height:800},{x:.5,y:.6,ancho:.3,alto:.14});assert.ok(Math.abs(rect.width/rect.height-900/340)<1e-9);assert.ok(rect.x>=300&&rect.x+rect.width<=480);assert.ok(rect.y>=208&&rect.y+rect.height<=320)});
test("convierte coordenadas del visor para /Rotate 0, 90, 180 y 270",()=>{const placement={x:.12,y:.18,ancho:.3,alto:.14};for(const angle of [0,90,180,270]){const rect=fitImageInPlacement({width:900,height:340},{x:0,y:0,width:600,height:800,rotation:angle},placement);assert.equal(rect.rotation,angle);assert.ok(rect.x>=0&&rect.y>=0);assert.ok(Number.isFinite(rect.width)&&Number.isFinite(rect.height))}assert.throws(()=>normalizePageRotation(45),/orientación PDF/)});
test("incrusta físicamente una imagen en un nuevo PDF",async()=>{
 const original=await PDFDocument.create();original.addPage([600,800]);const originalBytes=await original.save();const stamp=await makeCorporateStamp("Ana","Gerente");
 const files:Record<string,Uint8Array>={"original.pdf":originalBytes,"stamp.png":stamp.bytes};
 const db={storage:{from:()=>({download:async(path:string)=>({data:new Blob([asArrayBuffer(files[path])]),error:null})})}} as unknown as SupabaseClient;
 const result=await createSignedPdf(db,"original.pdf",[{tipo:"SELLO",pagina:1,x:.5,y:.6,ancho:.3,alto:.14,asset_path:"stamp.png"}]);
 assert.ok(result.bytes.length>originalBytes.length);assert.equal((await PDFDocument.load(result.bytes)).getPageCount(),1);
});
test("genera versión intermedia y final con ambas firmas sin alterar el original",async()=>{
 const original=await PDFDocument.create();original.addPage([600,800]);const originalBytes=await original.save();const originalHash=sha256(originalBytes);
 const [coordinatorStamp,managerStamp]=await Promise.all([makeCorporateStamp("Ana Coordinadora","Coordinadora"),makeCorporateStamp("Luis Gerente","Gerente")]);
 const files:Record<string,Uint8Array>={"original.pdf":originalBytes,"coordinator.png":coordinatorStamp.bytes,"manager.png":managerStamp.bytes};
 const db={storage:{from:()=>({download:async(path:string)=>({data:new Blob([asArrayBuffer(files[path])]),error:null})})}} as unknown as SupabaseClient;
 const intermediate=await createSignedPdf(db,"original.pdf",[{tipo:"SELLO",pagina:1,x:.12,y:.68,ancho:.28,alto:.13,asset_path:"coordinator.png"}]);
 files["intermediate.pdf"]=intermediate.bytes;
 const final=await createSignedPdf(db,"intermediate.pdf",[{tipo:"SELLO",pagina:1,x:.58,y:.68,ancho:.28,alto:.13,asset_path:"manager.png"}]);
 const intermediatePdf=await PDFDocument.load(intermediate.bytes);const finalPdf=await PDFDocument.load(final.bytes);
 const xObjects=(pdf:PDFDocument)=>pdf.getPage(0).node.Resources()?.lookup(PDFName.of("XObject"),PDFDict)?.keys().length||0;
 assert.equal(xObjects(intermediatePdf),1);assert.equal(xObjects(finalPdf),2);
 assert.equal(sha256(originalBytes),originalHash);assert.notEqual(intermediate.hash,originalHash);assert.notEqual(final.hash,intermediate.hash);
});
test("la migración conserva RLS y aplica permisos dentro de RPC",async()=>{const sql=await readFile("supabase/migrations/202609130002_documentos_firma.sql","utf8");for(const table of ["perfiles_firma","documentos","documento_firmas","documento_eventos"])assert.match(sql,new RegExp("alter table public\\."+table+" force row level security"));assert.match(sql,/role='coordinador'/);assert.match(sql,/private\.es_gerente\(\)/);assert.match(sql,/revoke all on function public\.confirmar_firma_documento/);assert.match(sql,/archivo_original_path/);assert.doesNotMatch(sql,/disable row level security/i)});
test("administra perfiles sin habilitar firma por administrador",async()=>{const sql=await readFile("supabase/migrations/202609130002_documentos_firma.sql","utf8");assert.match(sql,/admin_desactivar_perfil_firma/);assert.match(sql,/v_role not in \('coordinador','gerente'\)/);assert.match(sql,/not private\.es_gerente\(\)/)});
test("expone únicamente los tres tipos documentales acordados",async()=>{const [sql,route,form]=await Promise.all([readFile("supabase/migrations/202609130002_documentos_firma.sql","utf8"),readFile("app/api/documentos/route.ts","utf8"),readFile("components/new-document-form.tsx","utf8")]);for(const type of ["VACACIONES","LICENCIA_CON_GOCE","LICENCIA_SIN_GOCE"]){assert.match(sql,new RegExp(type));assert.match(route,new RegExp(type));assert.match(form,new RegExp(type))}for(const removed of ["PERMISO","MEMORANDO","OTRO"])assert.doesNotMatch(sql,new RegExp("'"+removed+"'"))});
test("la UI exige revisar la posición actual antes de enviar o firmar",async()=>{const source=await readFile("components/document-workspace.tsx","utf8");assert.match(source,/currentKey===previewKey/);assert.match(source,/dirty\|\|!previewed/);assert.match(source,/He revisado la vista previa/);assert.match(source,/Confirmar firma del documento/)});
test("la firma opcional del coordinador es incremental, inmutable y con permisos mínimos",async()=>{
 const sql=await readFile("supabase/migrations/202609140001_firma_coordinador.sql","utf8");
 assert.match(sql,/archivo_coordinador_path/);assert.match(sql,/coordinador_firmante_id=usuario_creador_id/);assert.match(sql,/FIRMADO_COORDINADOR/);
 assert.match(sql,/create trigger proteger_version_coordinador/);assert.match(sql,/create trigger proteger_colocaciones_coordinador_firmadas/);
 assert.match(sql,/v_doc\.usuario_creador_id<>auth\.uid\(\)/);assert.match(sql,/p\.role='coordinador'/);
 for(const fn of ["preparar_firma_coordinador","cancelar_preparacion_firma_coordinador","confirmar_firma_coordinador"]) {
  assert.match(sql,new RegExp("revoke all on function public\\."+fn+"\\([^;]+ from public,anon,authenticated"));
  assert.match(sql,new RegExp("grant execute on function public\\."+fn+"\\([^;]+ to authenticated"));
 }
 assert.doesNotMatch(sql,/disable row level security|service_role/i);
});
test("el gerente firma la versión intermedia cuando existe y nunca reincrusta posiciones del coordinador",async()=>{
 const [route,preview,version]=await Promise.all([readFile("app/api/documentos/[id]/accion/route.ts","utf8"),readFile("app/api/documentos/[id]/preview/route.ts","utf8"),readFile("lib/documents/version.ts","utf8")]);
 assert.equal(documentBasePath({archivo_original_path:"original.pdf",archivo_coordinador_path:"intermedia.pdf"}),"intermedia.pdf");
 assert.equal(documentBasePath({archivo_original_path:"original.pdf",archivo_coordinador_path:null}),"original.pdf");
 assert.match(route,/documentBasePath\(doc\)/);assert.match(preview,/documentBasePath\(document\)/);assert.match(version,/archivo_coordinador_path\|\|document\.archivo_original_path/);
 assert.equal([...route.matchAll(/\.eq\("usuario_id",profile\.id\)/g)].length,2);
 assert.match(route,/cancelar_preparacion_firma_coordinador/);assert.match(route,/remove\(\[coordinatorPath\]\)/);
});
test("la UX permite enviar sin firma y exige preview vigente para firmar",async()=>{
 const source=await readFile("components/document-workspace.tsx","utf8");
 assert.match(source,/canSend=props\.coordinatorSigned\|\|\(!dirty&&previewed\)/);
 assert.match(source,/Firmar como coordinador/);assert.match(source,/Puedes enviarlo sin firma/);
 assert.match(source,/loadedPdfType\.current!==props\.pdfType/);
});
test("el historial conserva eventos pero resume descargas repetidas",async()=>{const source=await readFile("components/document-history.tsx","utf8");assert.match(source,/Documento descargado.*downloads\.length/);assert.match(source,/Ver trazabilidad completa/);for(const event of ["CREADO","ENVIADO","OBSERVADO","RECHAZADO","FIRMADO"])assert.match(source,new RegExp(event))});
test("los activos y la vista previa se sirven con sesión y almacenamiento privado",async()=>{const [profile,asset,preview]=await Promise.all([readFile("app/api/perfil/firma/route.ts","utf8"),readFile("app/api/documentos/[id]/archivo/route.ts","utf8"),readFile("app/api/documentos/[id]/preview/route.ts","utf8")]);assert.match(profile,/getCurrentProfile/);assert.match(asset,/getCurrentProfile/);assert.match(asset,/documento_firmas/);assert.match(asset,/Cache-Control":"private, no-store"/);assert.match(preview,/getCurrentProfile/);assert.match(preview,/createSignedPdf/);assert.match(preview,/Cache-Control":"private, no-store"/);assert.doesNotMatch(profile+asset+preview,/getPublicUrl|createSignedUrl|service_role/i)});
test("la migración incremental conserva evidencia completa y permisos mínimos",async()=>{const sql=await readFile("supabase/migrations/202609140002_firma_evidencia.sql","utf8");for(const field of ["usuario_id","nombre","rol","cargo","perfil_firma_id","perfil_firma_version","version_firmada","path_previo","sha256_previo","path_resultante","sha256_resultante","fecha_servidor"])assert.match(sql,new RegExp("'"+field+"'"));assert.match(sql,/archivo_coordinador_path is not null/);assert.match(sql,/p_tipo not in \('original','coordinador','firmado'\)/);assert.match(sql,/revoke all on function public\.confirmar_firma_coordinador/);assert.match(sql,/revoke all on function public\.confirmar_firma_documento/);assert.match(sql,/grant execute on function public\.confirmar_firma_documento[^;]+ to authenticated/);assert.doesNotMatch(sql,/disable row level security|service_role/i)});

test("un PNG importado se conserva byte a byte como activo final",async()=>{
 const source=await sharp({create:{width:240,height:100,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:Buffer.from('<svg width="240" height="100"><path d="M8 75 C70 5 130 95 232 20" fill="none" stroke="#17365d" stroke-width="7"/></svg>')}]).png().toBuffer();
 const result=await normalizeImportedSignatureAsset(new File([source],"firma-sello.png",{type:"image/png"}));
 assert.deepEqual(Buffer.from(result.bytes),source);assert.equal(result.hash,sha256(source));
});

test("un WebP importado conserva dimensiones y transparencia sin componer texto",async()=>{
 const source=await sharp({create:{width:180,height:80,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:Buffer.from('<svg width="180" height="80"><circle cx="90" cy="40" r="24" fill="#174EA6" fill-opacity=".7"/></svg>')}]).webp({lossless:true}).toBuffer();
 const result=await normalizeImportedSignatureAsset(new File([source],"firma.webp",{type:"image/webp"}));const meta=await sharp(result.bytes).metadata();
 assert.equal(meta.format,"png");assert.equal(meta.width,180);assert.equal(meta.height,80);assert.equal(meta.hasAlpha,true);
});

test("la firma importada usa una sola imagen final y omite la plantilla corporativa",async()=>{
 const [route,form]=await Promise.all([readFile("app/api/perfil/firma/route.ts","utf8"),readFile("components/signature-profile-form.tsx","utf8")]);
 assert.match(route,/p_firma_path:assetPath,p_firma_sha256:asset\.hash,p_sello_path:assetPath,p_sello_sha256:asset\.hash/);
 assert.match(form,/No se agregarán textos, nombre, cargo, logo ni plantilla corporativa/);assert.match(form,/mode==="DIBUJADA"/);
});

test("el visor fija la rotación inicial y evita que un render anterior reemplace al vigente",async()=>{
 const source=await readFile("components/document-workspace.tsx","utf8");
 assert.match(source,/rotation=pdfPage\.rotate/);assert.match(source,/getViewport\(\{scale:1,rotation\}\)/);assert.match(source,/document\.createElement\("canvas"\)/);assert.match(source,/if\(!isCurrent\(\)\)return false/);assert.match(source,/renderSequence\.current/);
});

test("el detalle carga explícitamente la versión intermedia para el gerente",async()=>{
 const page=await readFile("app/(private)/documentos/[id]/page.tsx","utf8");
 assert.match(page,/managerReview\?\(coordinatorSigned\?"coordinador":"original"\)/);assert.doesNotMatch(page,/managerReview\?"base"/);
});
test("la versión intermedia y final conservan la orientación real de cada página",async()=>{
 const original=await PDFDocument.create();const page=original.addPage([600,800]);page.setRotation(degrees(180));const originalBytes=await original.save();
 const asset=await sharp({create:{width:160,height:60,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:Buffer.from('<svg width="160" height="60"><path d="M5 45 C45 2 100 58 155 10" fill="none" stroke="#0B1F3A" stroke-width="5"/></svg>')}]).png().toBuffer();
 const files:Record<string,Uint8Array>={"rotated.pdf":originalBytes,"asset.png":asset};const db={storage:{from:()=>({download:async(path:string)=>({data:new Blob([asArrayBuffer(files[path])]),error:null})})}} as unknown as SupabaseClient;
 const intermediate=await createSignedPdf(db,"rotated.pdf",[{tipo:"SELLO",pagina:1,x:.15,y:.7,ancho:.25,alto:.1,asset_path:"asset.png"}]);files["intermediate-rotated.pdf"]=intermediate.bytes;
 const final=await createSignedPdf(db,"intermediate-rotated.pdf",[{tipo:"SELLO",pagina:1,x:.6,y:.7,ancho:.25,alto:.1,asset_path:"asset.png"}]);
 assert.equal((await PDFDocument.load(intermediate.bytes)).getPage(0).getRotation().angle,180);assert.equal((await PDFDocument.load(final.bytes)).getPage(0).getRotation().angle,180);
});
