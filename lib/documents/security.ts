import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { normalizePageRotation } from "./placement";

export const DOCUMENT_BUCKET="documentos-firma";
export const MAX_PDF_BYTES=Number(process.env.DOCUMENT_MAX_BYTES||10*1024*1024);
export function sha256(bytes:Uint8Array){return createHash("sha256").update(bytes).digest("hex")}
export function safePdfName(name:string){
  const base=name.replace(/\.pdf$/i,"").normalize("NFKD").replace(/[^a-zA-Z0-9 _.-]/g,"").replace(/^\.+/,"").replace(/\s+/g," ").trim().slice(0,170);
  return `${base||"documento"}.pdf`;
}
export async function validatePdf(file:File){
  if(file.size<8||file.size>MAX_PDF_BYTES)throw new Error(`El PDF debe pesar como máximo ${Math.round(MAX_PDF_BYTES/1048576)} MB.`);
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(new TextDecoder().decode(bytes.slice(0,5))!=="%PDF-")throw new Error("El archivo no es un PDF válido.");
  let pdf:PDFDocument; try{pdf=await PDFDocument.load(bytes,{ignoreEncryption:false});}catch{throw new Error("El PDF está dañado, cifrado o no es compatible.");}
  const pages=pdf.getPageCount();if(pages<1||pages>500)throw new Error("El PDF debe contener entre 1 y 500 páginas.");
  for(const page of pdf.getPages())normalizePageRotation(page.getRotation().angle);
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
export async function normalizeImportedSignatureAsset(file:File){
  if(file.size>2*1024*1024)throw new Error("La imagen no puede superar 2 MB.");
  const input=Buffer.from(await file.arrayBuffer());
  const meta=await sharp(input,{failOn:"error"}).metadata();
  if(!["png","webp"].includes(meta.format||"")||!meta.width||!meta.height||meta.width>2400||meta.height>1200)throw new Error("Usa una imagen PNG o WebP válida, de hasta 2400 × 1200 px.");
  const bytes=meta.format==="png"?input:await sharp(input).png({compressionLevel:9}).toBuffer();
  return {bytes:new Uint8Array(bytes),hash:sha256(bytes)};
}
export async function makeCorporateStamp(name:string,role:string,signatureBytes?:Uint8Array|null,logoDataUri?:string){
  const clean=(value:string)=>value.replace(/[<>&'"]/g,"").slice(0,80);
  const safeLogo=logoDataUri?.startsWith("data:image/")?logoDataUri.replace(/"/g,"&quot;"):null;
  const logo=safeLogo?`<image href="${safeLogo}" x="350" y="12" width="200" height="48" preserveAspectRatio="xMidYMid meet"/>`:`<text x="450" y="48" text-anchor="middle" font-family="Arial" font-size="29" font-weight="600" letter-spacing="5" fill="#0B1F3A">SEGUROC</text>`;
  const signature=signatureBytes?.length?`<image href="data:image/png;base64,${Buffer.from(signatureBytes).toString("base64")}" x="245" y="66" width="410" height="150" preserveAspectRatio="xMidYMid meet"/>`:"";
  const safeName=clean(name),safeRole=clean(role);const nameSize=safeName.length>42?27:safeName.length>30?31:35;const roleSize=safeRole.length>42?21:24;
  const svg=`<svg width="900" height="340" viewBox="0 0 900 340" xmlns="http://www.w3.org/2000/svg">${logo}${signature}<text x="450" y="274" text-anchor="middle" font-family="Arial" font-size="${nameSize}" font-weight="600" fill="#0B1F3A">${safeName}</text><text x="450" y="310" text-anchor="middle" font-family="Arial" font-size="${roleSize}" font-weight="500" fill="#607089">${safeRole}</text></svg>`;
  const bytes=await sharp(Buffer.from(svg)).ensureAlpha().png({compressionLevel:9}).toBuffer();return {bytes,hash:sha256(bytes)};
}
