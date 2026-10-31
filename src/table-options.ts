// Explicit native options: each connector accepts only the fields it can use.
import type { Method, ResolvedTable } from "@ingestron/definitions";
import { webRequestSettings, webRequestProblems } from "./web-options.js";
import { isSecret, nonEmpty } from "./sql-auth.js";
import type { TableSource } from "./table-source.js";
const text = { type: "string", minLength: 1 };
/** Schema for named options; connector-specific applicability is checked below. */
export const sourceOptionsSchema: Method["settings"] = {
  type: "object",
  description: "Connector-specific native extraction options; unsupported fields are rejected.",
  additionalProperties: false,
  properties: {
    table_index: {
      type: "integer",
      minimum: 0,
      description: "Web table: zero-based HTML table index.",
    },
    exclude_last_request: {
      type: "boolean",
      description: "SAP Open Hub: exclude the last request. Full copies default to false.",
    },
    staging_sas: {
      description:
        "Snowflake or Databricks Delta: Key Vault secret containing the complete Azure Blob staging SAS URI.",
      type: "object",
      required: ["$secret"],
      additionalProperties: false,
      properties: {
        $secret: {
          ...text,
          description: "Name of the staging SAS secret in Key Vault.",
          examples: ["staging-sas"],
        },
      },
    },
    staging_path: {
      ...text,
      examples: ["staging/orders"],
      description:
        "Snowflake or Databricks Delta: relative container/folder for temporary exports.",
    },
    date_filter_column: {
      ...text,
      examples: ["CreatedDateTime"],
      description: "Microsoft 365: date column filtered by the trigger window.",
    },
    requires_date_filter: {
      type: "boolean",
      description: "Microsoft 365: declare whether the selected dataset requires a date filter.",
    },
    allowed_groups: {
      description: "Microsoft 365: up to ten group IDs to extract.",
      type: "array",
      minItems: 1,
      maxItems: 10,
      uniqueItems: true,
      items: text,
    },
    user_scope_filter: {
      ...text,
      examples: ["https://graph.microsoft.com/v1.0/users?$filter=Department eq 'Finance'"],
      description: "Microsoft 365: Graph user-filter URI; mutually exclusive with allowed_groups.",
    },
    collection_reference: {
      ...text,
      examples: ["$['items']"],
      description: "Hierarchical source: JSON path selecting the array of records.",
    },
    column_paths: {
      type: "object",
      additionalProperties: text,
      description:
        "Hierarchical source: contract column names mapped to native JSON paths. Root paths start with $; paths inside the selected array are relative.",
    },
    ...webRequestSettings,
    pagination: {
      type: "object",
      description:
        "REST native pagination rules for URLs, headers, query parameters and end conditions.",
      additionalProperties: false,
      properties: {
        AbsoluteUrl: {
          ...text,
          description: "REST pagination: path to the next-page URL in the response.",
          examples: ["$.nextLink"],
        },
        MaxRequestNumber: {
          type: "integer",
          minimum: 1,
          description: "REST pagination: maximum number of requests.",
        },
        SupportRFC5988: {
          type: "boolean",
          description: "REST pagination: follow RFC 5988 Link headers.",
        },
      },
      patternProperties: {
        "^(AbsoluteUrl\\.|QueryParameters\\.|Headers\\.|EndCondition:).+": text,
      },
    },
    schema: {
      ...text,
      examples: ["sales"],
      description: "Fabric Lakehouse: schema for a schema-enabled lakehouse.",
    },
  },
};
const allowed: Record<string, string[]> = {
  "web-table": ["table_index"],
  "sap-bw-open-hub": ["exclude_last_request"],
  snowflake: ["staging_sas", "staging_path"],
  "azure-databricks-delta": ["staging_sas", "staging_path"],
  "microsoft-365": [
    "date_filter_column",
    "requires_date_filter",
    "allowed_groups",
    "user_scope_filter",
  ],
  rest: ["collection_reference", "request_method", "request_body", "pagination"],
  "fabric-lakehouse": ["schema"],
};
/** The option names accepted by this source, also used by reference metadata.
 * @example sourceOptionNames(restSource) // ["collection_reference", ...]
 */
export function sourceOptionNames(source: TableSource): string[] {
  return [
    ...new Set([
      ...(allowed[source.id] ?? []),
      ...(source.hierarchical ? ["column_paths", "collection_reference"] : []),
    ]),
  ];
}
/** Validate dependencies and native restrictions before resource construction. */
export function sourceOptionProblems(table: ResolvedTable, source: TableSource): string[] {
  const settings = table.ingest!.settings;
  const options = (settings.source_options ?? {}) as Record<string, unknown>;
  const problems = Object.keys(options)
    .filter((key) => !sourceOptionNames(source).includes(key))
    .map((key) => `source_options.${key} is not supported for ${source.id}`);
  if (source.runtime && settings.runtime_kind !== source.runtime)
    problems.push(`${source.id} requires runtime_kind: ${source.runtime}`);
  if (source.id === "web-table" && options.table_index === undefined)
    problems.push("web-table requires source_options.table_index");
  problems.push(...stagingProblems(source, options), ...mappingProblems(table, options));
  if (source.id === "microsoft-365") problems.push(...officeProblems(table, options));
  else if (settings.format !== "parquet") problems.push(`${source.id} requires format: parquet`);
  return problems;
}
function officeProblems(table: ResolvedTable, options: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (table.ingest!.settings.format !== "json")
    problems.push("microsoft-365 requires format: json");
  if (typeof options.requires_date_filter !== "boolean")
    problems.push(
      "microsoft-365 requires source_options.requires_date_filter for the selected dataset",
    );
  if (options.requires_date_filter && !nonEmpty(options.date_filter_column))
    problems.push("this Microsoft 365 dataset requires date_filter_column");
  if (options.allowed_groups && options.user_scope_filter)
    problems.push("choose allowed_groups or user_scope_filter, not both");
  if (
    table.contract.columns.some(
      (column) => column.physicalName && column.physicalName !== column.name,
    )
  )
    problems.push(
      "Microsoft 365 cannot rename columns during extraction; contract names must match source names",
    );
  return problems;
}

function stagingProblems(source: TableSource, options: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (source.staged && (!isSecret(options.staging_sas) || !nonEmpty(options.staging_path)))
    problems.push(
      `${source.id} requires source_options.staging_sas as a secret reference and staging_path`,
    );
  if (nonEmpty(options.staging_path) && /(^|\/)\.\.(\/|$)|^\/|[@\\]/.test(options.staging_path))
    problems.push("staging_path must be a relative path without traversal or expressions");
  return problems;
}

function mappingProblems(table: ResolvedTable, options: Record<string, unknown>): string[] {
  const columns = new Set(table.contract.columns.map((column) => column.name));
  const problems = Object.keys((options.column_paths ?? {}) as object)
    .filter((key) => !columns.has(key))
    .map((key) => `column_paths.${key} is not a contract column`);
  problems.push(...webRequestProblems(options));
  return problems;
}
