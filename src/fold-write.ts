// The folded files: the factory's folder with the first target's values, the
// parameter definition, and an ARM parameter file per target (spec/behaviour.md,
// "Files").
import { splitDeployText, type SuppliedValue } from "@ingestron/definitions";
import {
  armParameters,
  setValueAt,
  valueAt,
  type ArmParameter,
  type Definition,
} from "./arm-export.js";
import type { Renders } from "./fold-files-compare.js";
import type { Models } from "./fold-problems.js";

/** The factory's root folder, which Microsoft's export reads, relative to the pack's folder. */
export const factoryFolder = "factory";

/** The parameter definition, in the factory's root folder, under the name Microsoft requires. */
export const definitionFile = `${factoryFolder}/arm-template-parameters-definition.json`;

/** A target's ARM deployment parameter file. */
export const parametersFile = (target: string) => `parameters/${target}.json`;

/** What a factory holds where a value is supplied when deploying. */
export const placeholder = (name: string) => `<value of ${name}>`;

/** The folded files, the deploy-time values they take, and their ARM parameters. */
export interface Folded {
  files: Record<string, string>;
  deployValues: SuppliedValue[];
  parameters: ArmParameter[];
}

/** ADF's Git JSON: tabs, and a final new line. */
export const jsonText = (data: unknown) => `${JSON.stringify(data, null, "\t")}\n`;

/** Writes the factory, the definition and each target's parameter file. */
export function writeFold(renders: Renders, models: Models, definition: Definition): Folded {
  const targets = Object.keys(renders);
  const first = renders[targets[0]!]!;
  const parameters = armParameters(first, definition);
  const supplied = new Map<string, string[]>();
  const files: Record<string, string> = {};
  for (const target of targets) {
    const values: Record<string, { value: unknown }> = {};
    for (const parameter of parameters) {
      const value = valueAt(JSON.parse(renders[target]![parameter.file]!), parameter.path);
      const name = deployName(value, models, target);
      if (name === undefined) values[parameter.name] = { value };
      else if (!supplied.get(name)?.includes(parameter.name))
        supplied.set(name, [...(supplied.get(name) ?? []), parameter.name]);
    }
    files[parametersFile(target)] = jsonText({
      $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
      contentVersion: "1.0.0.0",
      parameters: values,
    });
  }
  Object.assign(files, factoryFiles(first, parameters, models, targets[0]!));
  files[definitionFile] = jsonText(definition);
  return { files: sorted(files), deployValues: inOrder(models, supplied), parameters };
}

/** The deploy-time value's NAME when the value is one, whole. */
function deployName(value: unknown, models: Models, target: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const parts = splitDeployText(value, models[target]!.deployValues ?? []);
  const [part] = parts;
  return parts.length === 1 && typeof part !== "string" ? part!.name : undefined;
}

/** The first target's files, with a placeholder where it takes a deploy-time value. */
function factoryFiles(
  first: Readonly<Record<string, string>>,
  parameters: readonly ArmParameter[],
  models: Models,
  target: string,
): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [path, text] of Object.entries(first)) {
    const resource = JSON.parse(text) as unknown;
    let changed = false;
    for (const parameter of parameters.filter((item) => item.file === path)) {
      const name = deployName(valueAt(resource, parameter.path), models, target);
      if (name === undefined) continue;
      setValueAt(resource, parameter.path, placeholder(name));
      changed = true;
    }
    files[`${factoryFolder}/${path}`] = changed ? jsonText(resource) : text;
  }
  return files;
}

/** Each supplied value, in the order the models first hold them, taken in target order. */
function inOrder(models: Models, supplied: Map<string, string[]>): SuppliedValue[] {
  const names = new Set(
    Object.values(models).flatMap((model) => (model.deployValues ?? []).map((value) => value.name)),
  );
  return [...names]
    .filter((name) => supplied.has(name))
    .map((name) => ({ name, suppliedAs: supplied.get(name)! }));
}

function sorted(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.keys(files)
      .sort()
      .map((path) => [path, files[path]!]),
  );
}
