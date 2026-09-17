import React from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "../../components/app-shell";
import { AdminRequirements } from "../../components/admin-requirements";
import { EditRequirement } from "../../components/edit-requirement";
import NewRequirement from "../../components/new-requirement";
import { RequirementsList } from "../../components/requirements-list";
import { AdminMaintenance } from "../../components/admin-maintenance";
import { AdminImports } from "../../components/admin-imports";
import { AdminSectionNav } from "../../components/admin-section-nav";
import { DocumentList } from "../../components/document-list";
import { DocumentSectionNav } from "../../components/document-section-nav";
import { NewDocumentForm } from "../../components/new-document-form";
import { SignatureProfileForm } from "../../components/signature-profile-form";
import { DocumentWorkspace } from "../../components/document-workspace";
import { DocumentHistory } from "../../components/document-history";
import { editProfile, fixtureEdit } from "../fixtures/edit";
import type { AdminOptions, AdminResult } from "../../lib/admin/types";
import type { AdminFilters } from "../../lib/admin/filters";
import { parseRequirementQuery } from "../../lib/requirements/list-filters";

declare global { interface Window { __ADMIN_FIXTURE__: { initial: AdminResult; options: AdminOptions; initialFilters: AdminFilters } } }
const editing = window.location.pathname.endsWith("/editar");
const creating = window.location.pathname.endsWith("/nuevo");
const listing = window.location.pathname === "/requerimientos";
const maintenance = window.location.pathname === "/admin/mantenimiento";
const importing = window.location.pathname === "/admin/importaciones";
const documents = window.location.pathname === "/documentos";
const newDocument = window.location.pathname === "/documentos/nuevo";
const signatureProfile = window.location.pathname === "/perfil/firma";
const documentDetail = window.location.pathname === "/documentos/fixture";
const query = new URLSearchParams(window.location.search);
const fixture = fixtureEdit();
if (query.get("estado") === "Atendido") fixture.requerimiento.estado = "Atendido";
if (query.get("estado") === "Observado") fixture.requerimiento.estado = "Observado";
const coordinatorVersion=query.get("coordinator")==="1";
const documentFixture = {id:"77000000-0000-4000-8000-000000000001",tipo:"VACACIONES" as const,trabajador_id:"22000000-0000-4000-8000-000000000001",usuario_creador_id:editProfile.id,firmante_id:"88000000-0000-4000-8000-000000000001",estado:(query.get("role")==="coordinador"?"BORRADOR":"PENDIENTE_FIRMA") as "BORRADOR"|"PENDIENTE_FIRMA",observacion:null,comentario_decision:null,archivo_original_nombre:"solicitud-vacaciones.pdf",archivo_original_path:"original/test.pdf",archivo_original_sha256:"0".repeat(64),archivo_coordinador_path:coordinatorVersion?"coordinador/test.pdf":null,archivo_coordinador_sha256:coordinatorVersion?"a".repeat(64):null,archivo_firmado_sha256:null,coordinador_firmado_at:coordinatorVersion?"2026-09-13T12:08:00Z":null,coordinador_firmante_id:coordinatorVersion?editProfile.id:null,archivo_firmado_path:null,paginas:3,created_at:"2026-09-13T12:00:00Z",enviado_at:"2026-09-13T12:10:00Z",firmado_at:null,personal:{nombre:"MARÍA DE LOS ÁNGELES FERNÁNDEZ",dni:"12345678",cargo:"AGENTE OPERATIVA"},creador:{nombre:"Carlos Ramos"},coordinador_firmante:coordinatorVersion?{nombre:"Carlos Ramos"}:null,firmante:{nombre:"Gerente Seguroc"}};
const profile = documentDetail&&query.get("role")==="gerente"?{...editProfile,id:documentFixture.firmante_id,role:"gerente" as const,nombre:"Gerente Seguroc"}:(editing && query.get("role") !== "admin") || listing || documents || newDocument || signatureProfile || documentDetail ? editProfile : { ...editProfile, role: "admin" as const };
createRoot(document.getElementById("root")!).render(
  <AppShell profile={profile}>
    {documents ? <><DocumentSectionNav role={profile.role}/><DocumentList rows={[documentFixture]}/></> : documentDetail ? <section className="mx-auto max-w-7xl"><header className="page-header"><h1 className="page-title">Vacaciones</h1><p className="page-description">MARÍA DE LOS ÁNGELES FERNÁNDEZ · Gerente Seguroc</p>{coordinatorVersion&&profile.role==="gerente"&&<div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2"><strong className="text-sm text-emerald-900">Firmado previamente por coordinador</strong><p className="text-xs text-emerald-800">Carlos Ramos · 13 sept 2026, 07:08</p></div>}</header><DocumentWorkspace id={documentFixture.id} pages={3} status={documentFixture.estado} role={profile.role} userId={profile.id} creatorId={documentFixture.usuario_creador_id} signerId={documentFixture.firmante_id} placements={[]} profileReady={query.get("firma")!=="0"} coordinatorSigned={coordinatorVersion} pdfType={coordinatorVersion?"coordinador":"original"} pdfHash={coordinatorVersion?"a".repeat(64):"0".repeat(64)}/><DocumentHistory events={[{id:"1",accion:"CREADO",comentario:null,created_at:"2026-09-13T12:00:00Z",profiles:{nombre:"Carlos Ramos"}},{id:"2",accion:"DESCARGADO",comentario:null,created_at:"2026-09-13T12:05:00Z",profiles:{nombre:"Carlos Ramos"}},{id:"3",accion:"DESCARGADO",comentario:null,created_at:"2026-09-13T12:06:00Z",profiles:{nombre:"Carlos Ramos"}},{id:"4",accion:"ENVIADO",comentario:null,created_at:"2026-09-13T12:10:00Z",profiles:{nombre:"Carlos Ramos"}}]}/></section> : newDocument ? <><DocumentSectionNav role={profile.role}/><NewDocumentForm managers={[{id:documentFixture.firmante_id,nombre:"Gerente Seguroc"}]}/></> : signatureProfile ? <SignatureProfileForm initialName={profile.nombre} initialRole="Coordinador" configured updatedAt="2026-09-13T12:00:00Z"/> : editing ? <EditRequirement initial={fixture} profile={profile}/> : creating ? <NewRequirement/> : listing ? <RequirementsList initial={window.__ADMIN_FIXTURE__.initial} options={window.__ADMIN_FIXTURE__.options} initialFilters={parseRequirementQuery(query).filters}/> : maintenance ? <AdminMaintenance clients={window.__ADMIN_FIXTURE__.options.clientes.map(client=>({...client,activo:true}))}/> : importing ? <AdminImports/> : <><AdminSectionNav/><AdminRequirements {...window.__ADMIN_FIXTURE__} allowDeletion={query.get("delete")==="1"}/></>}
  </AppShell>
);
