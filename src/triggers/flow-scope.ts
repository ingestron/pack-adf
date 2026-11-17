// What ADF refuses about the triggers of a flow as a whole (spec/behaviour.md, "Flow triggers"):
// a tumbling window that depends on one this factory does not have, and a flow whose copies take
// more than one pipeline, each of which would carry a copy of the flow's triggers.
import type { ResolvedModel, ResolvedTable, ResolvedTrigger } from "@ingestron/definitions";
import { unnamedDependencies } from "./tumbling-trigger.js";

/** The tables this pack copies, by the flow whose triggers they carry. */
function flowTables(model: ResolvedModel): Map<string, ResolvedTable[]> {
  const flows = new Map<string, ResolvedTable[]>();
  for (const table of model.tables) {
    const triggers = table.ingest?.triggers ?? [];
    if (table.ingest?.pack !== "adf" || triggers.length === 0) continue;
    const flow = triggers[0]!.flow;
    flows.set(flow, [...(flows.get(flow) ?? []), table]);
  }
  return flows;
}

/** The triggers of a flow, from its first table: every table of a flow carries the same. */
const triggersOf = (tables: ResolvedTable[]): ResolvedTrigger[] =>
  tables[0]?.ingest?.triggers ?? [];

/** Each dependency on a tumbling window that no flow of this pack writes. */
function dependencyProblems(flows: Map<string, ResolvedTable[]>): string[] {
  const windows = new Set(
    [...flows.values()]
      .flatMap(triggersOf)
      .filter((trigger) => trigger.type === "tumbling-window")
      .map((trigger) => `${trigger.flow}/${trigger.name}`),
  );
  return [...flows.values()]
    .flatMap(triggersOf)
    .flatMap((trigger) =>
      trigger.type !== "tumbling-window"
        ? []
        : unnamedDependencies(trigger, windows).map(
            (key) =>
              `"${trigger.flow}/${trigger.name}" depends on "${key}", which this pack does not generate; a tumbling window can depend only on another of this factory's tumbling windows`,
          ),
    );
}

/** Each flow whose adf-copy tables are in more than one database, so more than one pipeline. */
function databaseProblems(flows: Map<string, ResolvedTable[]>): string[] {
  return [...flows].flatMap(([flow, tables]) => {
    const copies = tables.filter((table) => table.ingest!.method === "adf-copy");
    const databases = new Set(copies.map((table) => table.ingest!.object.split(".")[0]));
    return databases.size > 1
      ? [
          `The flow "${flow}" copies tables from more than one database and writes its own triggers; split it into one flow per database`,
        ]
      : [];
  });
}

/**
 * What ADF refuses about the triggers of each flow as a whole: a dependency on a tumbling window
 * this pack does not write, and a flow that copies from more than one database.
 * @example flowScopeProblems(model) // ['The flow "b" copies tables from more than one database ...']
 */
export function flowScopeProblems(model: ResolvedModel): string[] {
  const flows = flowTables(model);
  return [...dependencyProblems(flows), ...databaseProblems(flows)];
}
