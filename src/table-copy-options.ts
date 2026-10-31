// Connector-specific Copy activity fields, kept separate from common pipeline assembly.
import type { ResolvedTable } from "@ingestron/definitions";
import { reference } from "./resources.js";
import type { TableSource } from "./table-source.js";
type Data = Record<string, unknown>;
/** Native source settings from validated, explicitly named definition options. */
export function nativeSource(table: ResolvedTable, source: TableSource): Data {
  const settings = table.ingest!.settings;
  const options = (settings.source_options ?? {}) as Data;
  const result: Data = { type: source.source };
  if (settings.query !== undefined) result[source.queryProperty ?? "query"] = settings.query;
  if (source.id === "sap-bw-open-hub")
    result.excludeLastRequest = options.exclude_last_request ?? false;
  if (source.id === "snowflake") result.exportSettings = { type: "SnowflakeExportCopyCommand" };
  if (source.id === "azure-databricks-delta")
    result.exportSettings = { type: "AzureDatabricksDeltaLakeExportCommand" };
  if (source.id === "microsoft-365") Object.assign(result, officeSource(table, options));
  if (source.id === "rest") Object.assign(result, restSource(options));
  return result;
}
function officeSource(table: ResolvedTable, options: Data): Data {
  return {
    outputColumns: table.contract.columns.map((column) => ({ name: column.name })),
    ...(Boolean(options.date_filter_column) && {
      dateFilterColumn: options.date_filter_column,
      startTime: { value: "@pipeline().parameters.windowStart", type: "Expression" },
      endTime: { value: "@pipeline().parameters.windowEnd", type: "Expression" },
    }),
    ...(Boolean(options.allowed_groups) && { allowedGroups: options.allowed_groups }),
    ...(Boolean(options.user_scope_filter) && { userScopeFilterUri: options.user_scope_filter }),
  };
}
function restSource(options: Data): Data {
  return {
    requestMethod: options.request_method ?? "GET",
    ...(Boolean(options.request_body) && { requestBody: options.request_body }),
    ...(Boolean(options.pagination) && { paginationRules: options.pagination }),
  };
}
/** Native staging reference, or no extra activity fields for ordinary copies. */
export function stagingOptions(source: TableSource, service: string, path: unknown): Data {
  return source.staged
    ? {
        enableStaging: true,
        stagingSettings: { linkedServiceName: reference(service, "LinkedServiceReference"), path },
      }
    : {};
}
/** Contract columns are mapped to native names or JSON properties as appropriate. */
export function tableTranslator(table: ResolvedTable, source: TableSource): Data {
  if (source.id === "microsoft-365") return {};
  const options = (table.ingest!.settings.source_options ?? {}) as Data;
  return {
    translator: {
      type: "TabularTranslator",
      ...(Boolean(options.collection_reference) && {
        collectionReference: options.collection_reference,
      }),
      mappings: table.contract.columns.map((column) => ({
        source: source.hierarchical
          ? {
              path:
                (options.column_paths as Record<string, string> | undefined)?.[column.name] ??
                `${options.collection_reference ? "" : "$"}['${(column.physicalName ?? column.name).replaceAll("\\", "\\\\").replaceAll("'", "\\'")}']`,
            }
          : { name: column.physicalName ?? column.name },
        sink: { name: column.name },
      })),
    },
  };
}
