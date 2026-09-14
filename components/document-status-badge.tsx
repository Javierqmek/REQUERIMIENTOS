import type { DocumentStatus } from "@/lib/documents/types";
import { documentStatusLabel } from "@/lib/documents/types";
const styles:Record<DocumentStatus,string>={BORRADOR:"border-slate-200 bg-slate-50 text-slate-700",PENDIENTE_FIRMA:"border-amber-200 bg-amber-50 text-amber-800",OBSERVADO:"border-blue-200 bg-blue-50 text-blue-800",FIRMADO:"border-emerald-200 bg-emerald-50 text-emerald-800",RECHAZADO:"border-red-200 bg-red-50 text-red-800"};
export function DocumentStatusBadge({status}:{status:DocumentStatus}){return <span className={`inline-flex rounded-md border px-2 py-1 text-[11px] font-semibold leading-none ${styles[status]}`}>{documentStatusLabel[status]}</span>}
