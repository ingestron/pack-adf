// A resource has one owner; duplicate paths never silently replace earlier output.
import { nameLimits } from "./resource-names.js";
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

/** The folders whose resources Microsoft's export limits to `nameLimits.resource` characters. */
const limitedFolders = ["linkedService", "dataset", "pipeline", "trigger"];

/**
 * Refuses a name longer than Microsoft's export accepts, for names the pack derives
 * from others, such as after_copy's parent pipeline; `resourceName` checks the rest.
 */
export function checkNameLengths(files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    const folder = path.split("/")[0]!;
    if (!limitedFolders.includes(folder)) continue;
    const resource = JSON.parse(text) as { name: string; properties: { activities?: unknown[] } };
    if (resource.name.length > nameLimits.resource)
      throw new Error(tooLong(`${folder} name "${resource.name}"`, nameLimits.resource));
    for (const name of activityNames(resource.properties.activities ?? []))
      if (name.length > nameLimits.activity)
        throw new Error(
          tooLong(`activity name "${name}" in pipeline ${resource.name}`, nameLimits.activity),
        );
  }
}

function tooLong(what: string, limit: number): string {
  return `The ADF ${what} is longer than the ${limit} characters Microsoft's export accepts; shorten the project id or the resource_names it is made from`;
}

/** Every activity's name, with those inside ForEach, If and Until activities. */
function activityNames(activities: unknown[]): string[] {
  return activities.flatMap((activity) => {
    const { name, typeProperties } = activity as {
      name: string;
      typeProperties?: Record<string, unknown>;
    };
    const inner = ["activities", "ifTrueActivities", "ifFalseActivities"].flatMap(
      (key) => (typeProperties?.[key] as unknown[] | undefined) ?? [],
    );
    return [name, ...activityNames(inner)];
  });
}
