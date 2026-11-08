// The custom parameter definition, arm-template-parameters-definition.json, for the
// places of a fold: the property of each, by resource type, as Microsoft's format
// requires (spec/behaviour.md, "The definition file").
import type { EnvironmentsProblem } from "@ingestron/definitions";
import { definitionKeys, isExpression, type Definition, type Step } from "./arm-export.js";
import type { Renders } from "./fold-files-compare.js";
import type { Place } from "./fold-places.js";
import { differ, inEach, propertyLabel, resourceLabel, sameShape } from "./fold-problems.js";

type Data = Record<string, unknown>;

/** The definition for the places, and the places it cannot express. */
export function definitionFor(
  places: readonly Place[],
  renders: Renders,
): { definition: Definition; problems: EnvironmentsProblem[] } {
  const first = Object.values(renders)[0]!;
  const definition: Definition = {};
  const problems: EnvironmentsProblem[] = [];
  for (const place of places) {
    const action = actionOf(place);
    const keys = definitionKeys(place.file, JSON.parse(first[place.file]!));
    let node: Data = definition;
    for (const key of keys) node = (node[key] ??= {}) as Data;
    if (!action || keys.length === 0 || !insert(node, place.path, action))
      problems.push(notExpressed(place));
  }
  return { definition, problems };
}

/**
 * The action for a place: `-` keeps no default, so a stage that leaves a parameter out
 * fails to deploy rather than taking the first environment's value.
 */
function actionOf(place: Place): string | undefined {
  const literal = Object.entries(place.values).find(([target]) => !(target in place.deploy));
  const value = literal ? literal[1] : "";
  if (typeof value === "string" || isExpression(value)) return "-";
  if (Number.isInteger(value)) return "-::int";
  if (typeof value === "boolean") return "-::bool";
  if (Array.isArray(value)) return "-::array";
  return undefined;
}

/** Writes the action at the path, an array for each index; false where another entry is in the way. */
function insert(node: unknown, path: readonly Step[], action: string): boolean {
  const [step, ...rest] = path;
  const index = typeof step === "number";
  if (step === undefined || !isContainer(node, index)) return false;
  const container = node as Record<string | number, unknown>;
  const key = index ? 0 : step;
  if (rest.length === 0) {
    if (container[key] !== undefined && container[key] !== action) return false;
    container[key] = action;
    return true;
  }
  container[key] ??= typeof rest[0] === "number" ? [{}] : {};
  return insert(container[key], rest, action);
}

/** An object, or an array when `index`. */
function isContainer(node: unknown, index: boolean): boolean {
  return Boolean(node) && typeof node === "object" && Array.isArray(node) === index;
}

function notExpressed(place: Place): EnvironmentsProblem {
  return differ(
    `In ${resourceLabel(place.file)}, ${propertyLabel(place.path)} is ${inEach(place.values)}, which an ARM parameter definition cannot express.`,
    undefined,
    sameShape,
  );
}
