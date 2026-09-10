export function parseCsv(text:string){
  if(text.length>1024*1024)throw new Error("El archivo supera 1 MB.");
  const matrix:string[][]=[];let row:string[]=[],field="",quoted=false;
  for(let i=0;i<text.length;i++){const char=text[i];if(quoted){if(char==='"'&&text[i+1]==='"'){field+='"';i++;}else if(char==='"')quoted=false;else field+=char;}else if(char==='"'){if(field)throw new Error("CSV inválido: comillas inesperadas.");quoted=true;}else if(char===","){row.push(field);field="";}else if(char==="\n"){row.push(field.replace(/\r$/, ""));matrix.push(row);row=[];field="";}else field+=char;}
  if(quoted)throw new Error("CSV inválido: falta cerrar una comilla.");
  if(field||row.length){row.push(field.replace(/\r$/, ""));matrix.push(row)}
  const nonEmpty=matrix.filter(values=>values.some(value=>value.trim()));if(nonEmpty.length<2)throw new Error("El CSV debe incluir encabezados y al menos una fila.");
  const headers=nonEmpty[0].map((value,index)=>value.replace(index===0?/^\uFEFF/:/^$/,"").trim().toLowerCase());
  if(new Set(headers).size!==headers.length)throw new Error("El CSV contiene encabezados repetidos.");
  const rows=nonEmpty.slice(1).map((values,index)=>{if(values.length!==headers.length)throw new Error(`La fila ${index+2} no tiene ${headers.length} columnas.`);return Object.fromEntries(headers.map((header,i)=>[header,values[i]]));});
  return {headers,rows};
}
