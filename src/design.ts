// The design settings applied to generated resources: the Copy activity's
// policy and description, and the project's factory folder and annotations.
import type { Column, ResolvedModel, ResolvedTable } from "@ingestron/definitions";
import { auditValues } from "./design-settings.js";

type Data = Record<string, unknown>;

/** ADF's timespan, d.hh:mm:ss, from minutes. */
export function timespan(minutes: number): string {
  const two = (value: number) => String(value).padStart(2, "0");
  const days = Math.floor(minutes / 1440);
  return `${days}.${two(Math.floor((minutes % 1440) / 60))}:${two(minutes % 60)}:00`;
}

/**
 * The Copy activity's policy from `activity`, with only the keys set; `{}` without one.
 * @example policyOf(table) // { policy: { timeout: "0.02:00:00", retry: 2, retryIntervalInSeconds: 60 } }
 */
export function policyOf(table: ResolvedTable): { policy?: Data } {
  const activity = table.ingest!.settings.activity as
    { retries?: number; retry_interval?: number; timeout?: number } | undefined;
  if (!activity) return {};
  const policy: Data = {
    ...(activity.timeout !== undefined && { timeout: timespan(activity.timeout) }),
    ...(activity.retries !== undefined && { retry: activity.retries }),
    ...(activity.retry_interval !== undefined && {
      retryIntervalInSeconds: activity.retry_interval,
    }),
  };
  return Object.keys(policy).length > 0 ? { policy } : {};
}

/** What a table's Copy activity does, in one sentence. */
export function describeCopy(table: ResolvedTable, landed: "Parquet" | "JSON" | "files"): string {
  const object = table.ingest!.object;
  return landed === "files"
    ? `Copies the files of ${object} to landing as they are.`
    : `Copies ${object} to landing as ${landed}.`;
}

/** What a connection's pipeline does, in one sentence. */
export function describePipeline(tables: ResolvedTable[], how: string): string {
  const connection = tables[0]!.ingest!.connection.id;
  if (tables.length === 1) return `Copies one table from ${connection} to landing.`;
  return `Copies ${tables.length} tables from ${connection} to landing, ${how}.`;
}

/** Puts `description` after `name` and `policy` after `type`, the order ADF Studio writes. */
export function activity(
  name: string,
  description: string,
  type: string,
  rest: Data,
  policy: { policy?: Data },
): Data {
  return { name, description, type, ...policy, ...rest };
}

/** The project's folder and annotations, from its first ADF table (every table agrees). */
function designOf(model: ResolvedModel): { folder?: string; annotations: string[] } {
  const table = model.tables.find((candidate) => candidate.ingest?.pack === "adf");
  const settings = table?.ingest?.settings ?? {};
  return {
    folder: settings.folder as string | undefined,
    annotations: (settings.annotations as string[] | undefined) ?? [],
  };
}

/**
 * Files the project's pipelines and datasets in its folder and adds its
 * annotations to the pipelines. Every ADF table has the same values (checked).
 */
export function decorate(files: Record<string, string>, model: ResolvedModel): void {
  const { folder, annotations } = designOf(model);
  if (!folder && annotations.length === 0) return;
  for (const [path, text] of Object.entries(files)) {
    const kind = path.split("/")[0];
    if (kind !== "pipeline" && kind !== "dataset") continue;
    const resource = JSON.parse(text) as { properties: Data };
    if (folder) resource.properties.folder = { name: folder };
    if (kind === "pipeline") annotate(resource.properties, annotations);
    files[path] = `${JSON.stringify(resource, null, "\t")}\n`;
  }
}

/** Adds annotations after the pipeline's own, once each. */
function annotate(properties: Data, annotations: string[]): void {
  if (annotations.length === 0) return;
  const own = (properties.annotations as string[] | undefined) ?? [];
  properties.annotations = [...new Set([...own, ...annotations])];
}

/** The table's audit columns, name to value, in the order written. */
function auditColumns(table: ResolvedTable): [string, string][] {
  return Object.entries((table.ingest!.settings.audit_columns ?? {}) as Record<string, string>);
}

/**
 * The copy source's additionalColumns; `item` writes source values for a ForEach item.
 * @example additionalColumnsOf(table) // { additionalColumns: [{ name: "_run_id", value: { value: "@pipeline().RunId", type: "Expression" } }] }
 */
export function additionalColumnsOf(
  table: ResolvedTable,
  item = false,
): { additionalColumns?: Data[] } {
  const columns = auditColumns(table);
  if (columns.length === 0) return {};
  return {
    additionalColumns: columns.map(([name, written]) => {
      const known = auditValues[written];
      if (!known) return { name, value: written };
      const value = known.value(table, item);
      return {
        name,
        value: known.expression || value.startsWith("@") ? { value, type: "Expression" } : value,
      };
    }),
  };
}

/** Mappings for the audit columns, for copies that map their columns explicitly. */
export function auditMappings(table: ResolvedTable): Data[] {
  return auditColumns(table).map(([name]) => ({ source: { name }, sink: { name } }));
}

/** The audit columns as the landed files carry them, for the packs that read the files. */
export function auditOutputColumns(table: ResolvedTable): Column[] | undefined {
  const columns = auditColumns(table);
  if (columns.length === 0) return undefined;
  return columns.map(([name, written]) => {
    const known = auditValues[written];
    return {
      name,
      logicalType: known?.type ?? "string",
      nullable: false,
      description: `Added by ADF: ${known ? known.description : `the text "${written}"`}.`,
    };
  });
}
