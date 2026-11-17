// Which tables share a pipeline: those of one connection, and of one flow when the flow writes
// triggers or parameters, which its pipeline declares.
import type { ResolvedTable, ResolvedTrigger } from "@ingestron/definitions";
import { ownFlow } from "../resources/index.js";

type Add = (folder: string, resource: { name?: unknown; properties?: unknown }) => void;

/** `<connection>`, or `<connection>/<flow>` for a table whose flow has a pipeline of its own. */
export function groupKey(table: ResolvedTable): string {
  const flow = ownFlow(table);
  const connection = table.ingest!.connection.id;
  return flow === undefined ? connection : `${connection}/${flow}`;
}

/** What a group's resource names end with: `_<flow>` for a flow's own pipeline, else nothing. */
export function flowSuffix(tables: ResolvedTable[]): string {
  const flow = ownFlow(tables[0]!);
  return flow === undefined ? "" : `_${flow}`;
}

/** The triggers a group's flow writes; none for a group the default trigger starts. */
export function flowTriggers(tables: ResolvedTable[]): ResolvedTrigger[] {
  return ownFlow(tables[0]!) === undefined ? [] : (tables[0]!.ingest!.triggers ?? []);
}

/**
 * Wraps `add` so the resources groups of one connection share are written once, under the same
 * name. A repeat that differs from what was written goes to `add` again, which refuses it as
 * generated more than once; the same name from another connection collides likewise.
 */
export function onceFor(seen: Map<string, string>, base: string, add: Add): Add {
  return (folder, resource) => {
    const id = `${base}|${folder}/${String(resource.name)}`;
    const text = JSON.stringify(resource);
    if (seen.get(id) === text) return;
    seen.set(id, text);
    add(folder, resource);
  };
}

/**
 * The tables of each connection (or base) that has more than one group, such as flows with
 * pipelines of their own beside the rest. Groups that are alone are checked as they are.
 */
export function splitTables<T extends { tables: ResolvedTable[] }>(
  groups: T[],
  base: (group: T) => string,
): ResolvedTable[][] {
  const bases = new Map<string, { tables: ResolvedTable[]; groups: number }>();
  for (const group of groups) {
    const key = base(group);
    const found = bases.get(key) ?? { tables: [], groups: 0 };
    found.tables.push(...group.tables);
    found.groups += 1;
    bases.set(key, found);
  }
  return [...bases.values()].filter((found) => found.groups > 1).map((found) => found.tables);
}
