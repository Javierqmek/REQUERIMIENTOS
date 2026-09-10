export function allowTestRequirementDeletion() {
  return process.env.ALLOW_TEST_REQUIREMENT_DELETION?.trim().toLowerCase() === "true";
}
