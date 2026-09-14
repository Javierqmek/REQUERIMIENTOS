import Image from "next/image";

export function CorporateStampPreview({name,role,signatureSrc,logoSrc}:{name:string;role:string;signatureSrc?:string|null;logoSrc?:string|null}){
 return <div className="mx-auto flex aspect-[2.65/1] w-full max-w-[430px] flex-col items-center justify-between overflow-hidden bg-transparent px-5 py-3 text-center text-[#0B1F3A]">
  <div className="flex h-[18%] items-center justify-center">{logoSrc?<Image src={logoSrc} alt="Seguroc" width={112} height={32} className="max-h-full w-auto object-contain"/>:<span className="text-[clamp(10px,2.5vw,14px)] font-semibold tracking-[.12em]">SEGUROC</span>}</div>
  <div className="flex h-[42%] w-[58%] items-center justify-center">{signatureSrc?<Image unoptimized src={signatureSrc} alt="Firma manuscrita" width={260} height={90} className="h-full w-full object-contain"/>:<span className="text-xs italic text-[#8794A8]">Firma manuscrita</span>}</div>
  <div className="min-w-0 max-w-full leading-tight"><strong className="block truncate text-[clamp(11px,2.8vw,15px)] font-semibold">{name||"Nombre completo"}</strong><span className="mt-0.5 block truncate text-[clamp(9px,2.3vw,12px)] font-medium text-[#607089]">{role||"Cargo"}</span></div>
 </div>
}
