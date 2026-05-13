export function isProjectMilestoneType(type: unknown): boolean {
  if (type === "project-milestone") {
    return true;
  }
  if (Array.isArray(type)) {
    return type.some((item) => item === "project-milestone");
  }
  return false;
}
