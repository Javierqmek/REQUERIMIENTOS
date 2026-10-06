// Excel en Windows guarda CSV en Windows-1252 (ANSI) salvo que se elija UTF-8: se prueba UTF-8 estricto y, si no
// es válido, se lee como Windows-1252 para no romper tildes ni la ñ.
export function decodeCsvBytes(bytes:ArrayBuffer|Uint8Array){
  const view=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  try{return new TextDecoder("utf-8",{fatal:true}).decode(view)}catch{return new TextDecoder("windows-1252").decode(view)}
}
// Excel con configuración regional en español separa con punto y coma; en inglés, con coma. Se elige por la
// primera línea (fuera de comillas); una línea "sep=;" de Excel manda.
export function detectDelimiter(text:string){
  const body=text.replace(/^﻿/,"");
  const sep=body.match(/^sep=(.)\r?\n/i);if(sep)return sep[1];
  const counts:Record<string,number>={",":0,";":0,"\t":0};let quoted=false;
  for(const char of body){if(char==='"')quoted=!quoted;else if(!quoted){if(char==="\n"&&Object.values(counts).some(Boolean))break;if(char in counts)counts[char]++}}
  return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][1]>0?Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0]:",";
}
// rows: sin filas vacías (p. ej. ";;;;;;;" de Excel). filas: número de fila ORIGINAL del archivo (como lo ve Excel),
// para que los errores indiquen la fila correcta aunque haya filas vacías en medio.
export function parseCsv(text:string){
  if(text.length>1024*1024)throw new Error("El archivo supera 1 MB.");
  const delimiter=detectDelimiter(text);
  if(/^﻿?sep=.\r?\n/i.test(text))text=text.replace(/^(﻿?)sep=.\r?\n/i,"$1");
  const matrix:string[][]=[];let row:string[]=[],field="",quoted=false;
  for(let i=0;i<text.length;i++){const char=text[i];if(quoted){if(char==='"'&&text[i+1]==='"'){field+='"';i++;}else if(char==='"')quoted=false;else field+=char;}else if(char==='"'){if(field)throw new Error("CSV inválido: comillas inesperadas.");quoted=true;}else if(char===delimiter){row.push(field);field="";}else if(char==="\n"){row.push(field.replace(/\r$/, ""));matrix.push(row);row=[];field="";}else field+=char;}
  if(quoted)throw new Error("CSV inválido: falta cerrar una comilla.");
  if(field||row.length){row.push(field.replace(/\r$/, ""));matrix.push(row)}
  const records=matrix.map((values,index)=>({values,fila:index+1})).filter(record=>record.values.some(value=>value.trim()));
  if(records.length<2)throw new Error("El CSV debe incluir encabezados y al menos una fila.");
  const headerValues=records[0].values.map((value,index)=>value.replace(index===0?/^﻿/:/^$/,"").trim().toLowerCase());
  // Excel a veces agrega delimitadores vacíos al final de cada línea: se ignoran las columnas finales sin encabezado.
  let width=headerValues.length;while(width>0&&!headerValues[width-1])width--;
  const headers=headerValues.slice(0,width);
  if(new Set(headers).size!==headers.length)throw new Error("El CSV contiene encabezados repetidos.");
  const rows:Record<string,string>[]=[];const filas:number[]=[];
  for(const {values,fila} of records.slice(1)){
    if(values.length>width&&values.slice(width).some(value=>value.trim())||values.length<width)throw new Error(`La fila ${fila} no tiene ${width} columnas.`);
    rows.push(Object.fromEntries(headers.map((header,i)=>[header,values[i]])));filas.push(fila);
  }
  return {headers,rows,filas,delimiter};
}
