// The problems a fold of every environment into one factory reports, and the words
// they use (spec/behaviour.md, "What is refused").
import {
  splitDeployText,
  type DeployValue,
  type EnvironmentsProblem,
  type ResolvedModel,
  type TargetDifference,
} from "@ingestron/definitions";
import type { Step } from "./arm-export.js";

/** Each target's model, by name, in the order project.yaml declares the environments. */
export type Models = Readonly<Record<string, ResolvedModel>>;

/**
 * The first deploy-time value a target's text holds, and whether it is the whole text;
 * undefined when it holds none.
 */
export function deployPart(
  text: string,
  models: Models,
  target: string,
): { value: DeployValue; whole: boolean } | undefined {
  const parts = splitDeployText(text, models[target]!.deployValues ?? []);
  const value = parts.find((part): part is DeployValue => typeof part !== "string");
  return value && { value, whole: parts.length === 1 };
}

/** Where values that differ between environments are written. */
export const valuesFile = "project.yaml";

/** An `ENVIRONMENTS_DIFFER` error. */
export function differ(message: string, file = valuesFile, hint?: string): EnvironmentsProblem {
  return { code: "ENVIRONMENTS_DIFFER", severity: "error", message, file, ...(hint && { hint }) };
}

/** A `DEPLOY_VALUE` error at the first use of a deploy-time value. */
export function deployProblem(message: string, value: DeployValue, hint?: string) {
  const use = value.uses[0];
  const problem: EnvironmentsProblem = {
    code: "DEPLOY_VALUE",
    severity: "error",
    message,
    file: use?.file ?? valuesFile,
    ...(use?.line !== undefined && { line: use.line }),
    ...(hint && { hint }),
  };
  return problem;
}

/** Target names joined with `, `, the last two with ` and `. */
export function listOf(targets: readonly string[]): string {
  if (targets.length < 2) return targets.join("");
  return `${targets.slice(0, -1).join(", ")} and ${targets[targets.length - 1]}`;
}

/** Each problem once. */
export function once(problems: EnvironmentsProblem[]): EnvironmentsProblem[] {
  const seen = new Set<string>();
  return problems.filter((problem) => {
    const key = JSON.stringify([problem.code, problem.message, problem.file, problem.line]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const kinds: Record<string, string> = {
  linkedService: "linked service",
  dataset: "dataset",
  pipeline: "pipeline",
  trigger: "trigger",
  integrationRuntime: "integration runtime",
};

/** `the linked service "ls_x"`, for a resource's file. */
export function resourceLabel(file: string): string {
  const [folder = "", name = ""] = file.split("/");
  return `the ${kinds[folder] ?? folder} "${name.replace(/\.json$/, "")}"`;
}

/** A path in a resource as ADF's JSON writes it: `properties.activities[0].typeProperties.url`. */
export function propertyLabel(path: readonly Step[]): string {
  return path
    .map((step) => (typeof step === "number" ? `[${step}]` : `.${step}`))
    .join("")
    .replace(/^\./, "");
}

/** A value as the message quotes it, shortened. */
export function quoted(value: unknown): string {
  const text = value === undefined ? "not set" : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/** `"a" in dev and "b" in prod`, for each target's value. */
export function inEach(values: Readonly<Record<string, unknown>>): string {
  const groups = new Map<string, string[]>();
  for (const [target, value] of Object.entries(values))
    groups.set(quoted(value), [...(groups.get(quoted(value)) ?? []), target]);
  return listOf([...groups].map(([value, targets]) => `${value} in ${listOf(targets)}`));
}

/**
 * The method and connection settings that differ between the targets, as a sentence
 * naming each with its values, so a refusal says which setting to make the same.
 */
export function settingsThatDiffer(differing: readonly TargetDifference[]): string {
  const settings = new Map<string, string>();
  for (const { pointer, values } of differing) {
    const match =
      /^\/tables\/\d+\/ingest\/(?:connection\/)?settings\/([^/]+)/.exec(pointer) ??
      /^\/tables\/\d+\/ingest\/(object)$/.exec(pointer);
    if (match && !settings.has(match[1]!) && settings.size < 3)
      settings.set(match[1]!, `${match[1]} (${inEach(values)})`);
  }
  if (settings.size === 0) return "";
  return ` Settings that differ: ${[...settings.values()].join("; ")}.`;
}

/** The fix for a structural difference. */
export const sameShape =
  "Make the settings that shape this resource the same in every environment; only values such as names, paths and hosts may differ.";

/** The fix for a deploy-time value inside a longer text. */
export const wholeValue =
  "Make the variable hold the whole value, such as the full URL, or write the value in project.yaml for each environment.";
