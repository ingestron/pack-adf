// Where the targets' resources differ: each value that differs, or that is supplied
// when deploying, becomes a place for an ARM parameter; anything else that differs is
// refused (spec/behaviour.md, "Which values become parameters").
import { isDeepStrictEqual } from "node:util";
import type { DeployValue, EnvironmentsProblem } from "@ingestron/definitions";
import { isExpression, valueAt, type Step } from "./arm-export.js";
import type { Renders } from "./fold-files-compare.js";
import {
  deployPart,
  deployProblem,
  differ,
  inEach,
  propertyLabel,
  resourceLabel,
  sameShape,
  type Models,
  wholeValue,
} from "./fold-problems.js";

/** A value an ARM parameter takes: a value, an ADF expression's text, or a whole list. */
export interface Place {
  file: string;
  /** Where the definition file names it: an expression object, not its `value`. */
  path: Step[];
  /** The value in each target. */
  values: Record<string, unknown>;
  /** The deploy-time value's NAME in each target where it is supplied when deploying. */
  deploy: Record<string, string>;
}

/** The places of a fold, and what stops one. */
export interface Places {
  places: Place[];
  problems: EnvironmentsProblem[];
}

interface Walk extends Places {
  file: string;
  models: Models;
  docs: Record<string, unknown>;
}

/** Every place where the targets' renders differ or take a deploy-time value. */
export function findPlaces(renders: Renders, models: Models): Places {
  const targets = Object.keys(renders);
  const found: Places = { places: [], problems: [] };
  for (const file of Object.keys(renders[targets[0]!]!)) {
    const docs = Object.fromEntries(
      targets.map((target) => [target, JSON.parse(renders[target]![file]!)]),
    );
    compare({ ...found, file, models, docs }, [], docs);
  }
  return found;
}

const kindOf = (value: unknown) =>
  Array.isArray(value) ? "array" : value === null ? "null" : typeof value;

function compare(walk: Walk, path: Step[], values: Record<string, unknown>): void {
  const all = Object.values(values);
  if (all.every((value) => isDeepStrictEqual(value, all[0])) && !holdsDeploy(all[0])) return;
  const kinds = new Set(all.map(kindOf));
  if (kinds.size > 1) return void walk.problems.push(unlike(walk, path, values));
  const kind = kindOf(all[0]);
  if (kind === "array") return compareLists(walk, path, values as Record<string, unknown[]>);
  if (kind === "object") return compareObjects(walk, path, values as Record<string, object>);
  leaf(walk, path, values);
}

function holdsDeploy(value: unknown): boolean {
  return JSON.stringify(value).includes("${envvar:");
}

/** Lists of plain values are one parameter; lists of objects are compared item by item. */
function compareLists(walk: Walk, path: Step[], values: Record<string, unknown[]>) {
  const lists = Object.values(values);
  const plain = lists.every((list) => list.every((item) => typeof item !== "object" || !item));
  if (plain) return list(walk, path, values);
  if (new Set(lists.map((items) => items.length)).size > 1)
    return void walk.problems.push(unlike(walk, path, values));
  lists[0]!.forEach((_, index) =>
    compare(
      walk,
      [...path, index],
      each(values, (items) => items[index]),
    ),
  );
}

function compareObjects(walk: Walk, path: Step[], values: Record<string, object>) {
  const keys = Object.values(values).map((value) => Object.keys(value).sort().join(","));
  if (new Set(keys).size > 1) return void walk.problems.push(unlike(walk, path, values));
  for (const key of Object.keys(Object.values(values)[0]!))
    compare(
      walk,
      [...path, key],
      each(values, (value) => (value as Record<string, unknown>)[key]),
    );
}

/** A value: a place when it differs or a target supplies it when deploying. */
function leaf(walk: Walk, path: Step[], values: Record<string, unknown>): void {
  const deploy: Record<string, string> = {};
  for (const [target, value] of Object.entries(values)) {
    if (typeof value !== "string") continue;
    const part = deployPart(value, walk.models, target);
    if (!part) continue;
    if (!part.whole) return void walk.problems.push(embedded(walk, path, value, part.value));
    deploy[target] = part.value.name;
  }
  if (new Set(Object.values(deploy)).size > 1)
    return void walk.problems.push(twoNames(walk, path, deploy));
  const parent = path.slice(0, -1);
  const inExpression = path.at(-1) === "value" && isExpression(valueAt(firstDoc(walk), parent));
  walk.places.push({
    file: walk.file,
    path: inExpression ? parent : path,
    values: inExpression ? each(walk.docs, (doc) => valueAt(doc, parent)) : values,
    deploy,
  });
}

/** A list of plain values: one parameter, which no target can take from a deploy-time value. */
function list(walk: Walk, path: Step[], values: Record<string, unknown[]>): void {
  for (const [target, items] of Object.entries(values)) {
    const text = items.find((item) => typeof item === "string" && item.includes("${envvar:"));
    if (typeof text !== "string") continue;
    const named = deployPart(text, walk.models, target)?.value;
    if (!named) continue;
    const message = `"${named.text}" is supplied only when deploying, but it is in a list, at ${propertyLabel(path)} of ${resourceLabel(walk.file)}; an ARM parameter replaces the whole list.`;
    return void walk.problems.push(deployProblem(message, named, wholeValue));
  }
  walk.places.push({ file: walk.file, path, values, deploy: {} });
}

function firstDoc(walk: Walk): unknown {
  return Object.values(walk.docs)[0];
}

function each<T>(values: Record<string, T>, pick: (value: T) => unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([target, value]) => [target, pick(value)]));
}

function unlike(walk: Walk, path: Step[], values: Record<string, unknown>): EnvironmentsProblem {
  const where = path.length > 0 ? `${propertyLabel(path)} of ` : "";
  return differ(
    `In ${resourceLabel(walk.file)}, ${where}the resource differs between environments in more than a value: it is ${inEach(values)}.`,
    undefined,
    sameShape,
  );
}

function twoNames(walk: Walk, path: Step[], deploy: Record<string, string>) {
  const first = Object.keys(deploy)[0]!;
  const other = Object.keys(deploy).find((target) => deploy[target] !== deploy[first]);
  const values = walk.models[other!]!.deployValues ?? [];
  const value = values.find((item) => item.name === deploy[other!])!;
  return deployProblem(
    `At ${propertyLabel(path)} of ${resourceLabel(walk.file)}, this value is \${envvar:${deploy[first!]}} in ${first} and \${envvar:${deploy[other!]}} in ${other}.`,
    value,
    "Use one variable name and give it a different value in each pipeline stage.",
  );
}

function embedded(walk: Walk, path: Step[], text: string, value: DeployValue) {
  return deployProblem(
    `"${value.text}" is supplied only when deploying, but it is part of a longer value, "${text}", at ${propertyLabel(path)} of ${resourceLabel(walk.file)}; an ARM parameter replaces a whole value.`,
    value,
    wholeValue,
  );
}
