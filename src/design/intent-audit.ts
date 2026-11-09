// The audit columns a table's intent asks ADF to add.
import type { ResolvedTable } from "@ingestron/definitions";

/** The audit values of the intent that ADF adds, and the pack value each stands for. */
const intentAudit: Record<string, string> = {
  run_id: "run.id",
  window_start: "run.window_start",
  window_end: "run.window_end",
  source_object: "source.object",
  source_connection: "source.connection",
  loaded_at: "run.trigger_time",
};

/**
 * The audit columns the table's intent asks ADF to add, name to value, in the order written.
 * `loaded_at` is ADF's only when the table ends at the landed files; otherwise the store step
 * writes the table and adds it. Files copied as they are get none.
 */
export function intentAuditColumns(table: ResolvedTable): [string, string][] {
  if (table.ingest?.method === "adf-files") return [];
  return (table.intent.audit ?? []).flatMap(({ value, as }): [string, string][] => {
    const written = intentAudit[value];
    if (written === undefined || (value === "loaded_at" && table.store)) return [];
    return [[as, written]];
  });
}
