// What ADF tells other packs about each table's landed files, and the
// layouts it refuses because they would lose data or overwrite each other.
import type { ResolvedTable, StepOutput } from "@ingestron/definitions";
import { landedLocation, layoutOf, pathProblems, replacesFile, type Extension } from "./layout.js";

/** The tabular methods' files: the extension follows the source (JSON for Microsoft 365). */
export function extensionOf(table: ResolvedTable): Extension {
  return table.ingest!.connection.connector === "microsoft-365" ? "json" : "parquet";
}

/**
 * Where a tabular copy lands the table's files.
 * @example tableOutput(table) // { location: "abfss://…/orders/orders.parquet", format: "parquet", loads: "replace" }
 */
export function tableOutput(table: ResolvedTable): StepOutput {
  const extension = extensionOf(table);
  return {
    location: landedLocation(table, extension),
    format: extension,
    loads: replacesFile(table) ? "replace" : "add",
  };
}

/** Files copied as they are, when other packs can read their format. */
export function filesOutput(table: ResolvedTable): StepOutput | undefined {
  const { format, landing } = table.ingest!.settings;
  if (format !== "csv" && format !== "parquet" && format !== "json") return undefined;
  const root = String(landing).replace(/\/+$/, "");
  return { location: `${root}/${table.ingest!.object}/**`, format, loads: "add" };
}

/** Problems with a tabular copy's layout, as METHOD_CHECK messages. */
export function layoutProblems(table: ResolvedTable): string[] {
  const { layout, path, mode } = table.ingest!.settings;
  if (layout !== undefined && path !== undefined) return ["set layout or path, not both"];
  if (layoutOf(table) === "path") {
    const problems = pathProblems(String(path), extensionOf(table));
    if (problems.length > 0) return problems;
  }
  if (mode === "incremental" && replacesFile(table) && !table.store)
    return [
      "each run holds only the window's changes and replaces the last file, so changes would be lost; keep a file per run (layout: increments, or a path with {run}), or add a store step",
    ];
  return [];
}
