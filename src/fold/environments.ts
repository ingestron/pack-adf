// Every environment in one factory: the factory's Git folder with the first
// environment's values, a parameter definition for the values that differ, and an
// ARM parameter file per environment. Each fold is checked against every
// environment's own files before it is returned (spec/behaviour.md).
import {
  compareTargets,
  type EnvironmentsBuild,
  type EnvironmentsProblem,
  type TargetDifference,
} from "@ingestron/definitions";
import { addedSecretParameters } from "../factory/added-secrets.js";
import { valueAt } from "./arm-export.js";
import { build } from "../output/build.js";
import { countProblems, landingProblems, namedProblems } from "./fold-checks.js";
import { definitionFor } from "./fold-definition.js";
import { fileProblems, type Renders } from "./fold-files-compare.js";
import { addedSecretPackNotices, runtimePackNotices } from "./notices.js";
import { findPlaces, type Place } from "./fold-places.js";
import {
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
  const secrets = addedSecretParameters(Object.values(renders)[0]!);
  const errors = [...countProblems(folded, secrets), ...viewProblems(renders, folded)];
  if (errors.length > 0) return failed(errors);
  const deployValues = [
    ...folded.deployValues,
    ...secrets.map((secret) => ({ name: secret.name, suppliedAs: [secret.name] })),
  ];
  const warnings = [
    ...secretWarnings(places, renders),
    ...runtimePackNotices(models),
    ...addedSecretPackNotices(Object.values(renders)[0]!),
  ];
  return { files: folded.files, deployValues, problems: once(warnings) };
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
