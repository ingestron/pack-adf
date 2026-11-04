// What Microsoft's export makes of a factory's Git folder and its
// arm-template-parameters-definition.json: which values become ARM parameters, and
// under which names (spec/behaviour.md, "One factory for every environment"; the
// rules are Microsoft's, recorded with the experiments that confirm them in
// spec/references.md). Only the forms the pack writes are modelled.

/** One step into a resource's JSON: a key, or an index into an array. */
export type Step = string | number;

/** The definition file: per ARM resource type, a template of the values to parameterise. */
export type Definition = Record<string, unknown>;

/** A value the export makes an ARM parameter. */
export interface ArmParameter {
  /** The parameter's name, as the exported template declares it. */
  name: string;
  /** The resource's file, in the factory's folder, such as `linkedService/ls_x.json`. */
  file: string;
  /** Where the value is in the resource: inside an ADF expression object, its `value`. */
  path: Step[];
  /** The ARM parameter type: `string`, `int`, `bool`, `array` or `object`. */
  type: string;
}

/** The ARM resource type of each folder the pack writes. */
export const armTypes: Record<string, string> = {
  linkedService: "Microsoft.DataFactory/factories/linkedServices",
  dataset: "Microsoft.DataFactory/factories/datasets",
  pipeline: "Microsoft.DataFactory/factories/pipelines",
  trigger: "Microsoft.DataFactory/factories/triggers",
  integrationRuntime: "Microsoft.DataFactory/factories/integrationRuntimes",
};

/** Folders whose definitions are keyed by the resource's own `properties.type` first. */
export const typedFolders = new Set(["linkedService", "dataset"]);

type Data = Record<string, unknown>;

/** True for an ADF expression object, `{ "value": "@…", "type": "Expression" }`. */
export function isExpression(value: unknown): value is { value: string; type: string } {
  const data = value as Data | null;
  return Boolean(data && typeof data === "object" && data.type === "Expression" && "value" in data);
}

/**
 * The parameters the export makes of each resource, in path order. `files` are the
 * factory's resource files, by path relative to its root folder.
 * @example
 * armParameters({ "trigger/tr_x.json": text }, { "Microsoft.DataFactory/factories/triggers": { properties: { runtimeState: "-" } } });
 * // [{ name: "tr_x_properties_runtimeState", file: "trigger/tr_x.json", path: ["properties", "runtimeState"], type: "string" }]
 */
export function armParameters(
  files: Readonly<Record<string, string>>,
  definition: Definition,
): ArmParameter[] {
  const found: ArmParameter[] = [];
  for (const file of Object.keys(files).sort()) {
    const folder = file.split("/")[0]!;
    const resource = JSON.parse(files[file]!) as Data;
    const template = templateFor(definition, folder, resource);
    if (template === undefined) continue;
    const at = { file, resource: String(resource.name), found };
    walk(template, resource, at, [], []);
  }
  return found;
}

function templateFor(definition: Definition, folder: string, resource: Data): unknown {
  const kind = armTypes[folder];
  if (!kind) return undefined;
  const template = definition[kind] as Data | undefined;
  if (!template || !typedFolders.has(folder)) return template;
  return template[String((resource.properties as Data | undefined)?.type)];
}

interface Walk {
  file: string;
  resource: string;
  found: ArmParameter[];
}

/**
 * The export's naming: the resource's name, then each key down to the value, where a key
 * whose value is an array gives way to the index of each item in it.
 */
function walk(template: unknown, value: unknown, at: Walk, path: Step[], name: Step[]): void {
  if (typeof template === "string") {
    at.found.push(parameter(template, value, at, path, name));
  } else if (Array.isArray(template)) {
    if (!Array.isArray(value)) return;
    value.forEach((item, index) => walk(template[0], item, at, [...path, index], [...name, index]));
  } else if (isData(template) && isData(value)) {
    for (const [key, inner] of Object.entries(template)) {
      const child = value[key];
      if (child === undefined) continue;
      walk(inner, child, at, [...path, key], Array.isArray(child) ? name : [...name, key]);
    }
  }
}

function isData(value: unknown): value is Data {
  return Boolean(value) && typeof value === "object";
}

/** `<action>:<name>:<type>`: a blank name keeps the path, one starting with `-` only the resource. */
function parameter(
  action: string,
  value: unknown,
  at: Walk,
  path: Step[],
  name: Step[],
): ArmParameter {
  const [, given = "", type = ""] = action.split(":");
  let parts = name.map(String);
  if (given.startsWith("-")) parts = [given.slice(1)];
  else if (given) parts = [...parts.slice(0, -1), given];
  return {
    name: [at.resource, ...parts].join("_"),
    file: at.file,
    path: isExpression(value) ? [...path, "value"] : path,
    type: type || "string",
  };
}

/** The value at a path of steps, or undefined. */
export function valueAt(data: unknown, path: readonly Step[]): unknown {
  let node = data;
  for (const step of path) node = (node as Record<Step, unknown> | undefined)?.[step];
  return node;
}

/** Sets the value at a path of steps that exists. */
export function setValueAt(data: unknown, path: readonly Step[], value: unknown): void {
  const parent = valueAt(data, path.slice(0, -1)) as Record<Step, unknown>;
  parent[path[path.length - 1]!] = value;
}
