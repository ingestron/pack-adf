// What one target's ARM deployment makes of the folded files, in the layout `build`
// gives for that target alone (spec/behaviour.md, "The fold property"): the export's
// parameters, each set from parameters/<target>.json, or, where the deploying
// pipeline supplies it, the deploy-time value's text.
import { isDeepStrictEqual } from "node:util";
import type { SuppliedValue } from "@ingestron/definitions";
import { armParameters, setValueAt, type Definition } from "./arm-export.js";
import { definitionFile, factoryFolder, jsonText, parametersFile } from "./fold-write.js";

/** Each ARM parameter the deploying pipeline supplies, as its deploy-time value's text. */
export function suppliedTexts(deployValues: readonly SuppliedValue[]): Record<string, string> {
  return Object.fromEntries(
    deployValues.flatMap((value) =>
      value.suppliedAs.map((name) => [name, `\${envvar:${value.name}}`] as const),
    ),
  );
}

/**
 * The factory's resources as ARM deploys them for `target`: each value the definition
 * makes a parameter is the target's value, from its parameter file or `supplied`; a
 * parameter that neither sets keeps the factory's own value, so a missing one shows.
 */
export function factoryView(
  files: Readonly<Record<string, string>>,
  target: string,
  supplied: Readonly<Record<string, string>>,
): Record<string, string> {
  const definition = JSON.parse(files[definitionFile] ?? "{}") as Definition;
  const given = JSON.parse(files[parametersFile(target)] ?? "{}") as {
    parameters?: Record<string, { value: unknown }>;
  };
  const prefix = `${factoryFolder}/`;
  const factory = Object.fromEntries(
    Object.entries(files)
      .filter(([path]) => path.startsWith(prefix) && path !== definitionFile)
      .map(([path, text]) => [path.slice(prefix.length), text]),
  );
  const resources = Object.fromEntries(
    Object.entries(factory).map(([path, text]) => [path, JSON.parse(text) as unknown]),
  );
  for (const parameter of armParameters(factory, definition)) {
    const value = given.parameters?.[parameter.name]?.value ?? supplied[parameter.name];
    if (value !== undefined) setValueAt(resources[parameter.file], parameter.path, value);
  }
  return Object.fromEntries(
    Object.entries(resources).map(([path, resource]) => [path, jsonText(resource)]),
  );
}

/** Whether two resource files are the same, as JSON data. */
export function sameResource(_path: string, viewed: string, rendered: string): boolean {
  return isDeepStrictEqual(JSON.parse(viewed), JSON.parse(rendered));
}
