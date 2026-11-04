// Every environment in one factory: the factory's Git folder with the first
// environment's values, a parameter definition for the values that differ, and an
// ARM parameter file per environment. Each fold is checked against every
// environment's own files before it is returned (spec/behaviour.md).
import {
  compareTargets,
  splitDeployText,
  type DeployValue,
  type EnvironmentsBuild,
  type EnvironmentsProblem,
  type TargetDifference,
} from "@ingestron/definitions";
import { valueAt } from "./arm-export.js";
import { build } from "./build.js";
import { definitionFor } from "./fold-definition.js";
import { fileProblems, type Renders } from "./fold-files-compare.js";
import { findPlaces, type Place } from "./fold-places.js";
import {
  deployProblem,
  differ,
  inEach,
  listOf,
  once,
  resourceLabel,
  settingsThatDiffer,
  type Models,
} from "./fold-problems.js";
import { writeFold, type Folded } from "./fold-write.js";
import { factoryView, sameResource, suppliedTexts } from "./view.js";

/** Azure Resource Manager's limit on a template's parameters. */
export const armParameterLimit = 256;

/**
 * One factory for every target. With an error among the problems, the files are empty.
 * @example
 * const { files, deployValues, problems } = buildEnvironments({ dev: devModel, prod: prodModel });
 */
export function buildEnvironments(models: Models): EnvironmentsBuild {
  const { structural, differing } = compareTargets(models);
  if (structural.length > 0) return failed(structural);
  const landing = landingProblems(models);
  if (landing.length > 0) return failed(landing);
  const renders: Renders = Object.fromEntries(
    Object.entries(models).map(([target, model]) => [target, build(model)]),
  );
  const shape = [...namedProblems(renders, models), ...fileProblems(renders)];
  if (shape.length > 0) return failed(withSettings(shape, differing));
  const { places, problems } = findPlaces(renders, models);
  const { definition, problems: unexpressed } = definitionFor(places, renders);
  if (problems.length + unexpressed.length > 0)
    return failed(withSettings([...problems, ...unexpressed], differing));
  const folded = writeFold(renders, models, definition);
  const errors = [...countProblems(folded), ...viewProblems(renders, folded)];
  if (errors.length > 0) return failed(errors);
  const { files, deployValues } = folded;
  return { files, deployValues, problems: once(secretWarnings(places, renders)) };
}

function failed(problems: EnvironmentsProblem[]): EnvironmentsBuild {
  return { files: {}, deployValues: [], problems: once(problems) };
}

/** Each structural problem names the settings that differ between the targets. */
function withSettings(problems: EnvironmentsProblem[], differing: readonly TargetDifference[]) {
  const settings = settingsThatDiffer(differing);
  return problems.map((problem) =>
    problem.code === "ENVIRONMENTS_DIFFER"
      ? { ...problem, message: problem.message + settings }
      : problem,
  );
}

/** The first deploy-time value a text holds, in a target. */
function deployIn(text: string, models: Models, target: string): DeployValue | undefined {
  const parts = splitDeployText(text, models[target]!.deployValues ?? []);
  return parts.find((part): part is DeployValue => typeof part !== "string");
}

/** ADF splits the landing folder into the storage account, file system and folder. */
function landingProblems(models: Models): EnvironmentsProblem[] {
  return Object.keys(models).flatMap((target) =>
    models[target]!.tables.flatMap((table) => {
      const landing = table.ingest?.settings.landing;
      if (!/^adf-/.test(table.ingest?.method ?? "") || typeof landing !== "string") return [];
      const value = deployIn(landing, models, target);
      if (!value) return [];
      const message = `"${value.text}" is supplied only when deploying, but the landing folder "${landing}" holds it; ADF splits the landing into the storage account's URL, the file system and the folder, so each must be known when generating.`;
      return [deployProblem(message, value)];
    }),
  );
}

/** A resource named after a deploy-time value: names are decided when generating. */
function namedProblems(renders: Renders, models: Models): EnvironmentsProblem[] {
  return Object.keys(renders).flatMap((target) =>
    Object.keys(renders[target]!).flatMap((path) => {
      const value = deployIn(path, models, target);
      if (!value) return [];
      const message = `"${value.text}" is supplied only when deploying, so it cannot name ${resourceLabel(path)}; a factory's resources are named when generating.`;
      return [deployProblem(message, value)];
    }),
  );
}

function countProblems(folded: Folded): EnvironmentsProblem[] {
  const count = folded.parameters.length + 1;
  if (count <= armParameterLimit) return [];
  return [
    {
      code: "ARM_PARAMETERS",
      severity: "error",
      message: `The ARM template would have ${count} parameters: factoryName and ${count - 1} for values that differ between environments. Azure Resource Manager allows ${armParameterLimit}.`,
      file: "project.yaml",
    },
  ];
}

/**
 * The fold property, checked when generating: each target's view of the folded files
 * is what `build` gives for that target alone.
 */
function viewProblems(renders: Renders, folded: Folded): EnvironmentsProblem[] {
  const supplied = suppliedTexts(folded.deployValues);
  const unlike = new Map<string, string[]>();
  for (const [target, rendered] of Object.entries(renders)) {
    const viewed = factoryView(folded.files, target, supplied);
    for (const path of new Set([...Object.keys(viewed), ...Object.keys(rendered)])) {
      const view = viewed[path];
      const render = rendered[path];
      if (view !== undefined && render !== undefined && sameResource(path, view, render)) continue;
      unlike.set(path, [...(unlike.get(path) ?? []), target]);
    }
  }
  return [...unlike].map(([path, targets]) =>
    differ(
      `The folded factory does not give ${listOf(targets)} the same ${resourceLabel(path).replace(/^the /, "")} as building that environment alone does.`,
    ),
  );
}

/** A Key Vault secret whose name differs: Microsoft expects one vault per environment, same names. */
function secretWarnings(places: readonly Place[], renders: Renders): EnvironmentsProblem[] {
  const first = Object.values(renders)[0]!;
  return places.flatMap((place) => {
    const parent = valueAt(JSON.parse(first[place.file]!), place.path.slice(0, -1)) as
      { type?: string } | undefined;
    const literal = Object.entries(place.values).filter(([target]) => !(target in place.deploy));
    const names = new Set(literal.map(([, value]) => JSON.stringify(value)));
    if (
      place.path.at(-1) !== "secretName" ||
      parent?.type !== "AzureKeyVaultSecret" ||
      names.size < 2
    )
      return [];
    return [
      {
        code: "SECRET_NAME_DIFFERS" as const,
        severity: "warning" as const,
        message: `The Key Vault secret of ${resourceLabel(place.file)} is named ${inEach(Object.fromEntries(literal))}. It is a parameter, so it deploys, but Microsoft recommends a vault per environment with the same secret names, so that only the vault's URL differs.`,
        file: "project.yaml",
      },
    ];
  });
}
