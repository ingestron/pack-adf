// The pipeline parameters a flow declares: its own, and `load` when a trigger sets it.
import type { ResolvedTable } from "@ingestron/definitions";
import { isIncremental, plainValue, setsLoad } from "../design/index.js";

type Data = Record<string, unknown>;

/** The flow whose own pipeline copies the table; undefined when the flow writes neither triggers nor parameters. */
export function ownFlow(table: ResolvedTable): string | undefined {
  const ingest = table.ingest;
  if (table.origin.kind !== "Flow" || !ingest) return undefined;
  const writes =
    (ingest.triggers?.length ?? 0) > 0 || Object.keys(ingest.parameters ?? {}).length > 0;
  return writes ? table.origin.id : undefined;
}

const adfTypes = {
  string: "String",
  date: "String",
  datetime: "String",
  int: "Int",
  float: "Float",
  bool: "Bool",
} as const;

/**
 * The pipeline parameters a flow declares, and `load` when one of its triggers sets it: by default
 * `incremental` when any of the tables is, else `full`. None for a pipeline that has no flow of its own.
 */
export function flowParameters(tables: ResolvedTable[]): Data {
  const first = tables[0]!;
  if (ownFlow(first) === undefined) return {};
  const ingest = first.ingest!;
  const declared = Object.entries(ingest.parameters ?? {}).map(([name, parameter]) => [
    name,
    // A default is a literal; one that starts with `@`, or holds `@{`, is escaped.
    { type: adfTypes[parameter.type], defaultValue: plainValue(parameter.default) },
  ]);
  const mode = tables.some(isIncremental) ? "incremental" : "full";
  return Object.fromEntries([
    ...declared,
    ...(setsLoad(first) ? [["load", { type: "String", defaultValue: mode }]] : []),
  ]);
}
