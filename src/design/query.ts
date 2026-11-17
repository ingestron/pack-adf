// The SQL Server query of one copy: the contract's columns, renamed from
// their source names, and in incremental mode only the rows changed in the window.
import type { ResolvedTable } from "@ingestron/definitions";
import {
  concatenated,
  filterSegments,
  hasValues,
  interpolated,
  stamp,
  type Segment,
} from "./filter.js";

export { renderFilter } from "./filter.js";

type Data = Record<string, unknown>;

const bracket = (name: string) => `[${name.replaceAll("]", "]]")}]`;

/** The contract's columns, renamed from their source names, from the source table. */
export function selectOf(table: ResolvedTable): string {
  const [, schema, name] = table.ingest!.object.split(".");
  // A column named differently at the source is selected under its contract name.
  const columns = table.contract.columns
    .map((column) =>
      column.physicalName && column.physicalName !== column.name
        ? `${bracket(column.physicalName)} AS ${bracket(column.name)}`
        : bracket(column.name),
    )
    .join(",\n  ");
  return `SELECT\n  ${columns}\nFROM ${bracket(schema ?? "")}.${bracket(name ?? "")}`;
}

/** The bracketed watermark column in incremental mode, else "". */
export function watermarkOf(table: ResolvedTable): string {
  const settings = table.ingest!.settings;
  return settings.mode === "incremental" ? bracket(String(settings.watermark_column)) : "";
}

/** Whether the table copies only the rows changed in the window. */
export function isIncremental(table: ResolvedTable): boolean {
  return table.ingest!.settings.mode === "incremental";
}

/** Whether a trigger of the table's flow sets the built-in `load` parameter. */
export function setsLoad(table: ResolvedTable): boolean {
  return (table.ingest!.triggers ?? []).some((trigger) => trigger.parameters.load !== undefined);
}

/** `WHERE (a) AND (b)` on new lines for the predicates; nothing for none. */
const whereOf = (predicates: Segment[][]): Segment[] =>
  predicates.flatMap((item, at) => [at === 0 ? "\nWHERE (" : "\n  AND (", ...item, ")"]);

/** More predicates after the window, each on a line of its own. */
const andOf = (extra: Segment[][]): Segment[] =>
  extra.flatMap((item) => ["\n  AND (", ...item, ")"]);

/** The window: `a >= '…' AND a < '…'`, its times read from the pipeline's parameters. */
const windowOf = (watermark: string): Segment[] => [
  `${watermark} >= '`,
  { value: stamp("windowStart") },
  `'\n  AND ${watermark} < '`,
  { value: stamp("windowEnd") },
  "'",
];

/** The text of the segments: a string when nothing is read at run time, else an expression. */
const textOf = (segments: Segment[]): string | Data =>
  hasValues(segments) ? { value: interpolated(segments), type: "Expression" } : segments.join("");

/**
 * Text as it stands outside `@{…}` in an interpolated string: each `@{` doubled, so ADF reads it
 * as text, not as the start of an expression.
 */
const asText = (text: string) => text.replaceAll("@{", "@@{");

/**
 * The contract's columns; in incremental mode only rows changed in the window. When a trigger of
 * the table's flow sets `load`, an incremental table's query reads it: the select is written once,
 * as text, and only the WHERE part switches, a full run reading every row and any other only those
 * in the window. A full table's query never reads `load`. `extra` predicates and the table's own
 * `filter` narrow every branch, the filter last. The filter's closing parenthesis is on a line of
 * its own, so a `--` comment that ends the filter cannot comment it out.
 */
export function query(table: ResolvedTable, extra: string[] = []): string | Data {
  const select = selectOf(table);
  const watermark = watermarkOf(table);
  const { filter, parameters } = table.ingest!;
  const predicates = [
    ...extra.map((item) => [item]),
    ...(filter === undefined ? [] : [[...filterSegments(filter, parameters), "\n"]]),
  ];
  if (!watermark) return textOf([select, ...whereOf(predicates)]);
  const wrap = predicates.length > 0;
  const windowed = [
    "\nWHERE ",
    ...(wrap ? ["("] : []),
    ...windowOf(watermark),
    ...(wrap ? [")"] : []),
    ...andOf(predicates),
  ];
  if (!setsLoad(table)) return textOf([select, ...windowed]);
  const full = concatenated(whereOf(predicates));
  const value = `${asText(select)}@{if(equals(pipeline().parameters.load,'full'), ${full}, ${concatenated(windowed)})}`;
  return { value, type: "Expression" };
}
