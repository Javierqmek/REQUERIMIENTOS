import test from "node:test";
import assert from "node:assert/strict";
import { readdir,readFile,stat } from "node:fs/promises";
import { join } from "node:path";

const roots=["app","components","lib","proxy.ts","next.config.ts"];
const sourceExtension=/\.(?:ts|tsx|js|jsx|mjs)$/;
async function sourceFiles(path:string):Promise<string[]>{
 const info=await stat(path);
 if(info.isFile())return sourceExtension.test(path)?[path]:[];
 const entries=await readdir(path,{withFileTypes:true});
 const nested=await Promise.all(entries.filter(entry=>!entry.name.startsWith(".")).map(entry=>sourceFiles(join(path,entry.name))));
 return nested.flat();
}
const forbiddenLanguageApis:[string,RegExp][]=[
 ["Array.prototype.toReversed",/\.toReversed\s*\(/],
 ["Array.prototype.toSorted",/\.toSorted\s*\(/],
 ["Array.prototype.toSpliced",/\.toSpliced\s*\(/],
 ["Array.prototype.with",/\.with\s*\(/],
 ["Array.prototype.findLast",/\.findLast\s*\(/],
 ["Array.prototype.findLastIndex",/\.findLastIndex\s*\(/],
 ["Array.fromAsync",/Array\.fromAsync\s*\(/],
 ["Object.groupBy",/Object\.groupBy\s*\(/],
 ["Map.groupBy",/Map\.groupBy\s*\(/],
 ["structuredClone",/structuredClone\s*\(/],
 ["Promise.withResolvers",/Promise\.withResolvers\s*\(/],
 ["AbortSignal.timeout",/AbortSignal\.timeout\s*\(/],
 ["showOpenFilePicker",/showOpenFilePicker\s*\(/],
];
const forbiddenClientApis:[string,RegExp][]=[
 ["crypto.randomUUID",/crypto\.randomUUID\s*\(/],
 ["Clipboard API",/navigator\.clipboard/],
 ["Web Share API",/navigator\.share/],
 ["OffscreenCanvas",/\bOffscreenCanvas\b/],
 ["createImageBitmap",/\bcreateImageBitmap\b/],
 ["DOMMatrix",/\bDOMMatrix\b/],
];

test("el codigo propio no usa APIs modernas prohibidas",async()=>{
 const files=(await Promise.all(roots.map(sourceFiles))).flat();
 const violations:string[]=[];
 for(const file of files){
  const source=await readFile(file,"utf8");
  for(const [name,pattern] of forbiddenLanguageApis)if(pattern.test(source))violations.push(`${file}: ${name}`);
  if(/^\s*["']use client["'];/m.test(source))for(const [name,pattern] of forbiddenClientApis)if(pattern.test(source))violations.push(`${file}: ${name}`);
 }
 assert.equal(violations.join("\n"),"");
});

test("el CSS evita caracteristicas fuera del baseline",async()=>{
 const source=await readFile("app/globals.css","utf8");
 for(const pattern of [/:has\s*\(/,/@container\b/,/container-type\s*:/,/\bsubgrid\b/,/\b(?:dvh|svh|lvh)\b/,/color-mix\s*\(/,/\boklch\s*\(/])assert.doesNotMatch(source,pattern);
});

test("Browserslist conserva el baseline corporativo explicito",async()=>{
 const pkg=JSON.parse(await readFile("package.json","utf8")) as {browserslist?:{production?:string[]}};
 assert.deepEqual(pkg.browserslist?.production,["Chrome >= 109","Edge >= 109","Firefox >= 115","Safari >= 15.6","ios_saf >= 15.6","and_chr >= 109"]);
});

test("el visor usa PDF.js legacy y ResizeObserver tiene fallback",async()=>{
 const source=await readFile("components/document-workspace.tsx","utf8");
 assert.equal(source.match(/pdfjs-dist\/legacy\/build\/pdf\.mjs/g)?.length,2);
 assert.equal(source.match(/pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs/g)?.length,2);
 assert.doesNotMatch(source,/import\("pdfjs-dist"\)/);
 assert.match(source,/typeof ResizeObserver==="undefined"/);
 assert.match(source,/window\.addEventListener\("resize",redraw\)/);
});