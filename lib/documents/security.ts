import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

export const DOCUMENT_BUCKET="documentos-firma";
export const MAX_PDF_BYTES=Number(process.env.DOCUMENT_MAX_BYTES||10*1024*1024);
export function sha256(bytes:Uint8Array){return createHash("sha256").update(bytes).digest("hex")}
export function safePdfName(name:string){
  const base=name.replace(/\.pdf$/i,"").normalize("NFKD").replace(/[^a-zA-Z0-9 _.-]/g,"").replace(/\s+/g," ").trim().slice(0,170);
  return `${base||"documento"}.pdf`;
}
export async function validatePdf(file:File){
  if(file.size<8||file.size>MAX_PDF_BYTES)throw new Error(`El PDF debe pesar como máximo ${Math.round(MAX_PDF_BYTES/1048576)} MB.`);
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(new TextDecoder().decode(bytes.slice(0,5))!=="%PDF-")throw new Error("El archivo no es un PDF válido.");
  let pdf:PDFDocument; try{pdf=await PDFDocument.load(bytes,{ignoreEncryption:false});}catch{throw new Error("El PDF está dañado, cifrado o no es compatible.");}
  const pages=pdf.getPageCount();if(pages<1||pages>500)throw new Error("El PDF debe contener entre 1 y 500 páginas.");
  return {bytes,pages,hash:sha256(bytes),name:safePdfName(file.name)};
}
export async function normalizeSignature(file:File){
  if(file.size>2*1024*1024)throw new Error("La firma no puede superar 2 MB.");
  const input=Buffer.from(await file.arrayBuffer());
  const meta=await sharp(input,{failOn:"error"}).metadata();
  if(!["png","webp"].includes(meta.format||"")||!meta.width||!meta.height||meta.width>2400||meta.height>1200)throw new Error("Usa una imagen PNG o WebP válida, de hasta 2400 × 1200 px.");
  const bytes=await sharp(input).resize({width:1400,height:600,fit:"inside",withoutEnlargement:true}).png().toBuffer();
  return {bytes,hash:sha256(bytes)};
}
export async function makeCorporateStamp(name:string,role:string){
  const clean=(value:string)=>value.replace(/[<>&'"]/g,"").slice(0,80);
  const svg=`<svg width="900" height="340" xmlns="http://www.w3.org/2000/svg"><rect x="14" y="14" width="872" height="312" rx="28" fill="none" stroke="#0B1F3A" stroke-width="14"/><text x="450" y="105" text-anchor="middle" font-family="Arial" font-size="58" font-weight="700" fill="#0B1F3A">SEGUROC</text><line x1="90" y1="140" x2="810" y2="140" stroke="#0B1F3A" stroke-width="6"/><text x="450" y="213" text-anchor="middle" font-family="Arial" font-size="38" font-weight="600" fill="#0B1F3A">${clean(name)}</text><text x="450" y="270" text-anchor="middle" font-family="Arial" font-size="31" fill="#174EA6">${clean(role)}</text></svg>`;
  const bytes=await sharp(Buffer.from(svg)).png().toBuffer();return {bytes,hash:sha256(bytes)};
}
