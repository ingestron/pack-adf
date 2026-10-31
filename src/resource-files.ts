// A resource has one owner; duplicate paths never silently replace earlier output.
/** Add one native file, refusing case-insensitive resource or activity collisions. */
export function addResource(
  files: Record<string, string>,
  folder: string,
  resource: { name?: unknown; properties?: unknown },
): void {
  const path = `${folder}/${String(resource.name)}.json`;
  assertUnused(files, path);
  const activities = (resource.properties as { activities?: { name: string }[] })?.activities ?? [];
  const names = activities.map((activity) => activity.name.toLowerCase());
  if (new Set(names).size !== names.length)
    throw new Error(
      `ADF pipeline ${String(resource.name)} has duplicate activity names; choose distinct resource_names.copy_activity values`,
    );
  files[path] = `${JSON.stringify(resource, null, "\t")}\n`;
}
/** Merge independently assembled native files without dropping a resource. */
export function mergeResources(files: Record<string, string>, more: Record<string, string>): void {
  for (const [path, value] of Object.entries(more)) {
    assertUnused(files, path);
    files[path] = value;
  }
}
function assertUnused(files: Record<string, string>, path: string): void {
  if (Object.keys(files).some((existing) => existing.toLowerCase() === path.toLowerCase()))
    throw new Error(
      `ADF resource path ${path} is generated more than once (names are case-insensitive); choose distinct resource_names or connection and object names`,
    );
}
