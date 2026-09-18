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
import { VacationRequestForm } from "../../components/vacation-request-form";
import { VacationRequestList } from "../../components/vacation-request-list";
import { VacationReviewActions } from "../../components/vacation-review-actions";
import { VacationCorrectionForm } from "../../components/vacation-correction-form";
import { PapeletaEstadoBadge } from "../../components/papeleta-estado-badge";
import type { PapeletaDetailRow, PapeletaEstado, PapeletaRow } from "../../lib/vacations/types";
import { canCorrect, canReview } from "../../lib/vacations/review";
import { editProfile, fixtureEdit } from "../fixtures/edit";
import { IDS } from "../fixtures/admin";
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
const vacationsList = window.location.pathname === "/documentos/vacaciones";
const vacationsNew = window.location.pathname === "/documentos/vacaciones/nueva";
const vacationsDetail = window.location.pathname === "/documentos/vacaciones/fixture";
const query = new URLSearchParams(window.location.search);
const fixture = fixtureEdit();
if (query.get("estado") === "Atendido") fixture.requerimiento.estado = "Atendido";
if (query.get("estado") === "Observado") fixture.requerimiento.estado = "Observado";
const coordinatorVersion=query.get("coordinator")==="1";
const documentFixture = {id:"77000000-0000-4000-8000-000000000001",tipo:"VACACIONES" as const,trabajador_id:"22000000-0000-4000-8000-000000000001",usuario_creador_id:editProfile.id,firmante_id:"88000000-0000-4000-8000-000000000001",estado:(query.get("role")==="coordinador"?"BORRADOR":"PENDIENTE_FIRMA") as "BORRADOR"|"PENDIENTE_FIRMA",observacion:null,comentario_decision:null,archivo_original_nombre:"solicitud-vacaciones.pdf",archivo_original_path:"original/test.pdf",archivo_original_sha256:"0".repeat(64),archivo_coordinador_path:coordinatorVersion?"coordinador/test.pdf":null,archivo_coordinador_sha256:coordinatorVersion?"a".repeat(64):null,archivo_firmado_sha256:null,coordinador_firmado_at:coordinatorVersion?"2026-09-13T12:08:00Z":null,coordinador_firmante_id:coordinatorVersion?editProfile.id:null,archivo_firmado_path:null,paginas:3,created_at:"2026-09-13T12:00:00Z",enviado_at:"2026-09-13T12:10:00Z",firmado_at:null,personal:{nombre:"MARÍA DE LOS ÁNGELES FERNÁNDEZ",dni:"12345678",cargo:"AGENTE OPERATIVA"},creador:{nombre:"Carlos Ramos"},coordinador_firmante:coordinatorVersion?{nombre:"Carlos Ramos"}:null,firmante:{nombre:"Gerente Seguroc"}};
const papeletaFixtures: PapeletaRow[] = [{
  id: "aa000000-0000-4000-8000-000000000001", created_at: "2026-09-16T15:00:00Z",
  colaborador_nombre: "MARÍA AGENTE OPERATIVA", colaborador_codigo: "PER-001",
  fisicas_fecha_inicio: "2026-10-01", fisicas_fecha_fin: "2026-10-15", fisicas_dias: 15,
  tiene_venta: true, venta_fecha_inicio: "2026-10-16", venta_fecha_fin: "2026-10-20", venta_dias: 5,
  estado: "REGISTRADO", version_actual: 1, motivo_observacion: null, archivo_nombre: "papeleta-maria.pdf",
  reemplazo: { nombre: "CARLOS REEMPLAZO OPERATIVO" }, provincias: { nombre: "AREQUIPA" },
  clientes: { nombre: "RENIEC" }, unidades: { nombre: "OFICINA REGISTRAL ATE" }, profiles: { nombre: "Javier Quispe" },
}];
// Nombre de parámetro deliberadamente distinto de "estado": ese nombre ya lo usa
// parseAdminQuery en el servidor de pruebas para filtros de requerimientos (Pendiente/
// Atendido/Observado) y un valor como OBSERVADO (mayúsculas, de papeletas) lo hace fallar.
const detailEstado = (query.get("pstate") || "REGISTRADO") as PapeletaEstado;
const papeletaDetailFixture: PapeletaDetailRow = {
  id: "aa000000-0000-4000-8000-000000000001", created_at: "2026-09-16T15:00:00Z", updated_at: "2026-09-16T15:00:00Z",
  coordinador_id: editProfile.id,
  colaborador_id: "22000000-0000-4000-8000-000000000001", colaborador_nombre: "MARÍA AGENTE OPERATIVA", colaborador_codigo: "PER-001",
  fisicas_fecha_inicio: "2026-10-01", fisicas_fecha_fin: "2026-10-15", fisicas_dias: 15,
  tiene_venta: true, venta_fecha_inicio: "2026-10-16", venta_fecha_fin: "2026-10-20", venta_dias: 5,
  estado: detailEstado, version_actual: 1,
  motivo_observacion: detailEstado === "OBSERVADO" ? "El rango de venta se cruza con vacaciones físicas." : null,
  archivo_nombre: "papeleta-maria.pdf",
  reemplazo_id: "22000000-0000-4000-8000-000000000002",
  provincia_id: "aa100000-0000-4000-8000-000000000001", cliente_id: IDS.cliente, unidad_id: IDS.unidad,
  reemplazo: { id: "22000000-0000-4000-8000-000000000002", nombre: "CARLOS REEMPLAZO OPERATIVO", dni: "87654321", cargo: "AGENTE", codigo_personal: "PER-002" },
  provincias: { id: "aa100000-0000-4000-8000-000000000001", nombre: "AREQUIPA" },
  clientes: { id: IDS.cliente, nombre: "RENIEC" }, unidades: { id: IDS.unidad, nombre: "OFICINA REGISTRAL ATE" },
  profiles: { nombre: "Javier Quispe" },
};
const profile = documentDetail&&query.get("role")==="gerente"?{...editProfile,id:documentFixture.firmante_id,role:"gerente" as const,nombre:"Gerente Seguroc"}
  // El admin/gerente que revisa una papeleta en el detalle NUNCA es la misma persona que el
  // coordinador dueño (papeletaDetailFixture.coordinador_id === editProfile.id): usar el mismo
  // id rompería canReview (que exige ownerId !== userId) y ocultaría los botones de revisión.
  :vacationsDetail&&query.get("role")==="admin"?{...editProfile,id:"a3000000-0000-4000-8000-000000000001",role:"admin" as const}
  :vacationsDetail&&query.get("role")==="gerente"?{...editProfile,id:"88000000-0000-4000-8000-000000000001",role:"gerente" as const,nombre:"Gerente Seguroc"}
  :vacationsList&&query.get("role")==="admin"?{...editProfile,role:"admin" as const}
  :(editing && query.get("role") !== "admin") || listing || documents || newDocument || signatureProfile || documentDetail || vacationsList || vacationsNew || vacationsDetail ? editProfile : { ...editProfile, role: "admin" as const };
createRoot(document.getElementById("root")!).render(
  <AppShell profile={profile}>
    {documents ? <><DocumentSectionNav role={profile.role}/><DocumentList rows={[documentFixture]}/></> : documentDetail ? <section className="mx-auto max-w-7xl"><header className="page-header"><h1 className="page-title">Vacaciones</h1><p className="page-description">MARÍA DE LOS ÁNGELES FERNÁNDEZ · Gerente Seguroc</p>{coordinatorVersion&&profile.role==="gerente"&&<div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2"><strong className="text-sm text-emerald-900">Firmado previamente por coordinador</strong><p className="text-xs text-emerald-800">Carlos Ramos · 13 sept 2026, 07:08</p></div>}</header><DocumentWorkspace id={documentFixture.id} pages={3} status={documentFixture.estado} role={profile.role} userId={profile.id} creatorId={documentFixture.usuario_creador_id} signerId={documentFixture.firmante_id} placements={[]} profileReady={query.get("firma")!=="0"} coordinatorSigned={coordinatorVersion} pdfType={coordinatorVersion?"coordinador":"original"} pdfHash={coordinatorVersion?"a".repeat(64):"0".repeat(64)}/><DocumentHistory events={[{id:"1",accion:"CREADO",comentario:null,created_at:"2026-09-13T12:00:00Z",profiles:{nombre:"Carlos Ramos"}},{id:"2",accion:"DESCARGADO",comentario:null,created_at:"2026-09-13T12:05:00Z",profiles:{nombre:"Carlos Ramos"}},{id:"3",accion:"DESCARGADO",comentario:null,created_at:"2026-09-13T12:06:00Z",profiles:{nombre:"Carlos Ramos"}},{id:"4",accion:"ENVIADO",comentario:null,created_at:"2026-09-13T12:10:00Z",profiles:{nombre:"Carlos Ramos"}}]}/></section> : newDocument ? <><DocumentSectionNav role={profile.role}/><NewDocumentForm managers={[{id:documentFixture.firmante_id,nombre:"Gerente Seguroc"}]}/></> : vacationsList ? <><DocumentSectionNav role={profile.role}/><section className="mx-auto max-w-5xl"><header className="page-header"><h1 className="page-title">{profile.role==="coordinador"?"Mis papeletas de vacaciones":"Papeletas de vacaciones"}</h1></header><VacationRequestList rows={papeletaFixtures} showCoordinador={profile.role!=="coordinador"}/></section></> : vacationsNew ? <><DocumentSectionNav role={profile.role}/><section className="mx-auto max-w-3xl"><header className="page-header"><h1 className="page-title">Registrar papeleta de vacaciones</h1></header><VacationRequestForm coordinadorNombre={profile.nombre}/></section></> : vacationsDetail ? <><DocumentSectionNav role={profile.role}/><section className="mx-auto max-w-3xl"><header className="page-header flex items-center justify-between gap-3"><h1 className="page-title">Papeleta de vacaciones</h1><PapeletaEstadoBadge estado={papeletaDetailFixture.estado}/></header>
  {papeletaDetailFixture.estado==="OBSERVADO"&&papeletaDetailFixture.motivo_observacion&&<div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><strong className="font-semibold">Motivo de observación: </strong>{papeletaDetailFixture.motivo_observacion}</div>}
  <div className="section-card"><h2 className="section-title">Datos de la papeleta</h2><dl className="mt-3 grid gap-x-8 gap-y-1 sm:grid-cols-2"><div className="border-t border-[#E8EDF4] py-2"><dt className="text-xs font-medium text-[#607089]">Colaborador</dt><dd className="mt-0.5 text-sm font-medium">{papeletaDetailFixture.colaborador_nombre} ({papeletaDetailFixture.colaborador_codigo})</dd></div></dl></div>
  {canReview(profile.role,papeletaDetailFixture.coordinador_id,profile.id)&&papeletaDetailFixture.estado==="REGISTRADO"&&<div className="mt-4"><VacationReviewActions papeletaId={papeletaDetailFixture.id}/></div>}
  {canCorrect(profile.role,papeletaDetailFixture.coordinador_id,profile.id,papeletaDetailFixture.estado)&&<div className="mt-4"><div className="section-card"><h2 className="section-title">Corregir papeleta observada</h2></div><div className="mt-4"><VacationCorrectionForm papeleta={papeletaDetailFixture}/></div></div>}
</section></> : signatureProfile ? <SignatureProfileForm initialName={profile.nombre} initialRole="Coordinador" configured updatedAt="2026-09-13T12:00:00Z"/> : editing ? <EditRequirement initial={fixture} profile={profile}/> : creating ? <NewRequirement/> : listing ? <RequirementsList initial={window.__ADMIN_FIXTURE__.initial} options={window.__ADMIN_FIXTURE__.options} initialFilters={parseRequirementQuery(query).filters}/> : maintenance ? <AdminMaintenance clients={window.__ADMIN_FIXTURE__.options.clientes.map(client=>({...client,activo:true}))}/> : importing ? <AdminImports/> : <><AdminSectionNav/><AdminRequirements {...window.__ADMIN_FIXTURE__} allowDeletion={query.get("delete")==="1"}/></>}
  </AppShell>
);
