"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, LoaderCircle } from "lucide-react";
export function NavigationLink({href,children,className="",showArrow=true}:{href:string;children:React.ReactNode;className?:string;showArrow?:boolean}){const router=useRouter();const [loading,setLoading]=useState(false);return <button type="button" disabled={loading} onClick={()=>{setLoading(true);router.push(href)}} className={className}>{children}{loading?<LoaderCircle className="shrink-0 animate-spin text-blue-600" size={20}/>:showArrow?<ChevronRight className="shrink-0 text-slate-400"/>:null}</button>}
