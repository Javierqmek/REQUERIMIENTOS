// Mismo principio que lib/admin/config.ts (ALLOW_TEST_REQUIREMENT_DELETION): un flag de entorno
// además del flag en private.app_config, para poder deshabilitar el borrado de papeletas de
// prueba en producción sin tocar la base de datos.
export function allowTestPapeletaDeletion() {
  return process.env.ALLOW_TEST_PAPELETA_DELETION?.trim().toLowerCase() === "true";
}
