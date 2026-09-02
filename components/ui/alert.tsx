import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";

type Kind = "success" | "error" | "warning" | "info";
const styles: Record<Kind,string> = { success:"border-emerald-200 bg-emerald-50 text-emerald-900", error:"border-red-200 bg-red-50 text-red-900", warning:"border-amber-200 bg-amber-50 text-amber-900", info:"border-blue-200 bg-blue-50 text-blue-900" };
const icons = { success:CheckCircle2, error:AlertCircle, warning:TriangleAlert, info:Info };
export function Alert({kind="info",children}:{kind?:Kind;children:React.ReactNode}){const Icon=icons[kind];return <div role={kind==="error"?"alert":"status"} className={`flex items-start gap-3 rounded-xl border p-4 text-sm font-medium ${styles[kind]}`}><Icon className="mt-0.5 shrink-0" size={19}/><div className="min-w-0 flex-1 break-words">{children}</div></div>}
