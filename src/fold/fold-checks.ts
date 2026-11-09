// Checks on a fold that are not comparisons of the targets' resources: deploy-time
// values where ADF cannot take them, and the ARM template's parameter count
// (spec/behaviour.md, "What is refused").
import type { EnvironmentsProblem } from "@ingestron/definitions";
import type { AddedSecret } from "../factory/index.js";
import type { Step } from "./arm-export.js";
import type { Renders } from "./fold-files-compare.js";
import type { Folded } from "./fold-write.js";
import {
  deployPart,
  deployProblem,
  listOf,
  propertyLabel,
  resourceLabel,
  valuesFile,
  type Models,
} from "./fold-problems.js";

/** Azure Resource Manager's limit on a template's parameters. */
export const armParameterLimit = 256;

/** ADF splits the landing folder into the storage account, file system and folder. */
export function landingProblems(models: Models): EnvironmentsProblem[] {
  return Object.keys(models).flatMap((target) =>
    models[target]!.tables.flatMap((table) => {
      const landing = table.ingest?.settings.landing;
      if (!/^adf-/.test(table.ingest?.method ?? "") || typeof landing !== "string") return [];
      const value = deployPart(landing, models, target)?.value;
      if (!value) return [];
      const message = `"${value.text}" is supplied only when deploying, but the landing folder "${landing}" holds it; ADF splits the landing into the storage account's URL, the file system and the folder, so each must be known when generating.`;
      return [
        deployProblem(
          message,
          value,
          "Write the landing folder in project.yaml for each environment, such as abfss://landing@<account>.dfs.core.windows.net/<folder>.",
        ),
      ];
    }),
  );
}

/** A resource named after a deploy-time value: names are decided when generating. */
export function namedProblems(renders: Renders, models: Models): EnvironmentsProblem[] {
  return Object.keys(renders).flatMap((target) =>
    Object.keys(renders[target]!).flatMap((path) => {
      const value = deployPart(path, models, target)?.value;
      if (!value) return [];
      const message = `"${value.text}" is supplied only when deploying, so it cannot name ${resourceLabel(path)}; a factory's resources are named when generating.`;
      const what = path.startsWith("integrationRuntime/")
        ? "the integration runtime's name"
        : "the value this resource is named after";
      return [deployProblem(message, value, `Write ${what} in project.yaml for each environment.`)];
    }),
  );
}

/**
 * More than ARM's 256 parameters, counting `factoryName` and the secure strings the
 * export adds, with the properties that make the most.
 */
export function countProblems(
  folded: Folded,
  secrets: readonly AddedSecret[],
): EnvironmentsProblem[] {
  const count = folded.parameters.length + secrets.length + 1;
  if (count <= armParameterLimit) return [];
  const parts = [
    "factoryName",
    `${folded.parameters.length} for values that differ between environments`,
    ...(secrets.length > 0
      ? [`${secrets.length} secure string${secrets.length === 1 ? "" : "s"} the export adds`]
      : []),
  ];
  const problem: EnvironmentsProblem = {
    code: "ARM_PARAMETERS",
    severity: "error",
    message: `The ARM template would have ${count} parameters: ${listOf(parts)}. Azure Resource Manager allows ${armParameterLimit}. The most come from ${busiest(folded)}.`,
    file: valuesFile,
    hint: "Microsoft suggests three ways: make fewer values differ between environments, such as an audit column that holds the environment's name; give values that are the same in many places one global parameter; or split the definitions into more than one factory.",
  };
  return [problem];
}

/** The three properties with the most parameters, as `<property> of <kind> (<count>)`. */
function busiest(folded: Folded): string {
  const counts = new Map<string, number>();
  for (const parameter of folded.parameters) {
    const general = parameter.path.map((step: Step) => (typeof step === "number" ? 0 : step));
    const kind = resourceLabel(parameter.file).replace(/^the | "[^"]*"$/g, "");
    const key = `${propertyLabel(general).replaceAll("[0]", "[]")} of each ${kind}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([property, number]) => `${property} (${number})`)
    .join(", ");
}
