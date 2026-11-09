// The first check of a fold: every target builds the same resources, under the same
// names, with the same integration runtimes (spec/behaviour.md, "What is refused").
import type { EnvironmentsProblem } from "@ingestron/definitions";
import { differ, listOf, resourceLabel } from "./fold-problems.js";

/** Each target's own files, as `build` gives them, by target. */
export type Renders = Readonly<Record<string, Readonly<Record<string, string>>>>;

const sameNames =
  "Resource names must be the same in every environment, because one ARM template is deployed to each factory. Name the resource with resource_names, such as resource_names.pipeline, or keep what it is named after, such as the object's database, the same in every environment.";

const sameRuntime =
  "Use the same integration runtime name and runtime_kind in every environment's factory, as Microsoft's CI/CD expects; set integration_runtime outside the environments' values.";

/** The problems with the targets' file sets: none when every target has the same paths and runtimes. */
export function fileProblems(renders: Renders): EnvironmentsProblem[] {
  const targets = Object.keys(renders);
  const runtimes = runtimeProblems(renders, targets);
  if (runtimes.length > 0) return runtimes;
  const folders = new Set(
    targets.flatMap((target) => Object.keys(renders[target]!).map((path) => path.split("/")[0]!)),
  );
  return [...folders].flatMap((folder) => folderProblems(renders, targets, folder));
}

/** Runtimes must have the same names and types in every target; other differences are values or shapes. */
function runtimeProblems(renders: Renders, targets: string[]): EnvironmentsProblem[] {
  const runtimes = targets.map((target) =>
    Object.entries(renders[target]!)
      .filter(([path]) => path.startsWith("integrationRuntime/"))
      .map(([path, text]) => `${path.slice(19, -5)} (${String(JSON.parse(text).properties.type)})`)
      .join(", "),
  );
  const other = runtimes.findIndex((runtime) => runtime !== runtimes[0]);
  if (other < 0) return [];
  const describe = (index: number) => runtimes[index] || "none";
  return [
    differ(
      `The integration runtimes are ${describe(0)} in ${targets[0]} and ${describe(other)} in ${targets[other]}; Microsoft's CI/CD needs each runtime to have the same name and type in every environment.`,
      undefined,
      sameRuntime,
    ),
  ];
}

/**
 * One folder's files: a resource some targets build and others do not, or, when each
 * target builds as many, the resources whose names differ, paired in the order built.
 */
function folderProblems(renders: Renders, targets: string[], folder: string) {
  const paths = targets.map((target) =>
    Object.keys(renders[target]!).filter((path) => path.startsWith(`${folder}/`)),
  );
  const first = paths[0]!;
  const problems: EnvironmentsProblem[] = [];
  targets.slice(1).forEach((target, index) => {
    const other = paths[index + 1]!;
    if (other.length !== first.length) return;
    first.forEach((path, at) => {
      if (other[at] !== path) problems.push(renamed(path, other[at]!, targets[0]!, target));
    });
  });
  if (problems.length > 0) return problems;
  const all = [...new Set(paths.flat())];
  return all.flatMap((path) => {
    const yes = targets.filter((_, index) => paths[index]!.includes(path));
    if (yes.length === targets.length) return [];
    const no = targets.filter((target) => !yes.includes(target));
    return [
      differ(
        `${capital(resourceLabel(path))} is built in ${listOf(yes)} but not in ${listOf(no)}; every environment's factory must have the same resources.`,
      ),
    ];
  });
}

function renamed(path: string, other: string, first: string, target: string) {
  const name = (file: string) => file.split("/")[1]!.replace(/\.json$/, "");
  const label = resourceLabel(path).replace(/ "[^"]*"$/, "");
  return differ(
    `${capital(label)} is named "${name(path)}" in ${first} and "${name(other)}" in ${target}.`,
    undefined,
    sameNames,
  );
}

function capital(text: string): string {
  return text.replace(/^the /, "The ");
}
