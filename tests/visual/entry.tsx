import React from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "../../components/app-shell";
import { AdminRequirements } from "../../components/admin-requirements";
import { EditRequirement } from "../../components/edit-requirement";
import { NewRequirement } from "../../components/new-requirement";
import { RequirementsList } from "../../components/requirements-list";
import { AdminMaintenance } from "../../components/admin-maintenance";
import { AdminImports } from "../../components/admin-imports";
import { AdminSectionNav } from "../../components/admin-section-nav";
import { editProfile, fixtureEdit } from "../fixtures/edit";
import type { AdminOptions, AdminResult } from "../../lib/admin/types";
import type { AdminFilters } from "../../lib/admin/filters";

declare global { interface Window { __ADMIN_FIXTURE__: { initial: AdminResult; options: AdminOptions; initialFilters: AdminFilters } } }
const editing = window.location.pathname.endsWith("/editar");
const creating = window.location.pathname.endsWith("/nuevo");
const listing = window.location.pathname === "/requerimientos";
const maintenance = window.location.pathname === "/admin/mantenimiento";
const importing = window.location.pathname === "/admin/importaciones";
const query = new URLSearchParams(window.location.search);
const fixture = fixtureEdit();
if (query.get("estado") === "Atendido") fixture.requerimiento.estado = "Atendido";
if (query.get("estado") === "Observado") fixture.requerimiento.estado = "Observado";
const profile = editing && query.get("role") !== "admin" ? editProfile : { ...editProfile, role: "admin" as const };
createRoot(document.getElementById("root")!).render(
  <AppShell profile={profile}>
    {editing ? <EditRequirement initial={fixture} profile={profile}/> : creating ? <NewRequirement/> : listing ? <RequirementsList rows={window.__ADMIN_FIXTURE__.initial.rows}/> : maintenance ? <AdminMaintenance clients={window.__ADMIN_FIXTURE__.options.clientes}/> : importing ? <AdminImports/> : <><AdminSectionNav/><AdminRequirements {...window.__ADMIN_FIXTURE__} allowDeletion={query.get("delete")==="1"}/></>}
  </AppShell>
);
