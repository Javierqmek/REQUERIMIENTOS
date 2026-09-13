import type { DocumentStatus } from "@/lib/documents/types";
import { documentStatusLabel } from "@/lib/documents/types";
const styles:Record<DocumentStatus,string>={BORRADOR:"bg-slate-100 text-slate-700",PENDIENTE_FIRMA:"bg-amber-100 text-amber-800",OBSERVADO:"bg-orange-100 text-orange-800",FIRMADO:"bg-emerald-100 text-emerald-800",RECHAZADO:"bg-red-100 text-red-800"};
export function DocumentStatusBadge({status}:{status:DocumentStatus}){return <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${styles[status]}`}>{documentStatusLabel[status]}</span>}
