// Full native copies use the existing method settings and connection checks.
import type { Connector, Method, ResolvedTable } from "@ingestron/definitions";
import { layoutSettings, tablePlacement, windowSettings } from "./method.js";
import { nonEmpty } from "./sql-auth.js";
import { connectionProblems } from "./connection-check.js";
import { tableCloud } from "./table-cloud.js";
import { tableExports } from "./table-exports.js";
import { sourceOptionNames, sourceOptionProblems, sourceOptionsSchema } from "./table-options.js";
import { tableApps } from "./table-apps.js";
import { tableCrm } from "./table-crm.js";
import { tableSap } from "./table-sap.js";
import { tableProtocols } from "./table-protocols.js";
import { tableDatabases } from "./table-databases.js";
import { tableAnalytics } from "./table-analytics.js";
import type { TableSource } from "./table-source.js";

/** Concrete native table sources. No source is registered without its required properties. */
export const tableSources = [
  ...tableDatabases,
  ...tableAnalytics,
  ...tableApps,
  ...tableCrm,
  ...tableSap,
  ...tableProtocols,
  ...tableCloud,
  ...tableExports,
];

/** Native full-copy method, with ordinary schema-checked settings. */
export const adfTable: Method = {
  action: "ingest",
  description:
    "Copy the selected native source into Parquet landing files, or JSON for Microsoft 365. Full selections only; the store controls append or merge behaviour.",
  connectors: tableSources.map((source) => source.id),
  connectivity: ["private", "workspace", "public"],
  produces: "files",
  renames: true,
  placement: tablePlacement,
  defaults: {
    runtime_kind: "self-hosted",
    format: "parquet",
    mode: "full",
    every: { frequency: "Hour", interval: 24 },
    retries: 2,
  },
  settings: {
    type: "object",
    additionalProperties: false,
    required: ["landing", "integration_runtime", "key_vault", "start"],
    properties: {
      ...windowSettings,
      ...layoutSettings,
      runtime_kind: {
        enum: ["azure", "self-hosted"],
        enumDescriptions: [
          "An Azure integration runtime.",
          "A self-hosted integration runtime with the required drivers and network access.",
        ],
        description: "Kind of the named integration runtime. Must match the deployed runtime.",
      },
      source_options: sourceOptionsSchema,
      format: {
        enum: ["parquet", "json"],
        enumDescriptions: [
          "Parquet for ordinary native table sources.",
          "JSON for Microsoft 365 extraction.",
        ],
        description: "Landing format read by the downstream store.",
      },
      mode: { enum: ["full"], description: "Copy the full selected source each window." },
      query: {
        examples: ["SELECT * FROM orders"],
        type: "string",
        minLength: 1,
        description:
          "Native read query where supported. Required for Azure Data Explorer, Google Ads, MariaDB, SAP BW MDX and SAP HANA. Does not implement managed incremental state.",
      },
    },
  },
  check: checkTable,
};

/** Connection facts, rendered by the existing authoring and documentation surfaces. */
export const tableConnectors: Connector[] = tableSources.map((source) => ({
  id: source.id,
  title: source.title,
  category: sourceCategory(source),
  method: "adf-table",
  reading: {
    query: source.queryRequired ? "required" : source.query ? "optional" : "unsupported",
    sourceOptions: sourceOptionNames(source),
    format: source.id === "microsoft-365" ? "json" : "parquet",
    ...(source.runtime && { runtime: source.runtime }),
  },
  object: source.object.join(".") || "a name for the query result",
  settings: Object.entries(source.fields).map(([name, field]) => ({
    name,
    description: field.description,
    ...(field.secret && { secret: true }),
    ...(field.optional && { optional: true }),
    ...(field.number && { type: "number" as const }),
    ...(field.secretMap && { type: "object" as const }),
    ...(field.values && { values: field.values }),
  })),
  generates: `a ${source.service} linked service, a full copy pipeline and a tumbling window trigger`,
  maturity: { status: "GA", checked: "2026-10-28" },
  docs: `https://learn.microsoft.com/en-us/azure/data-factory/connector-${source.docs}`,
}));

function checkTable(table: ResolvedTable): string[] {
  const ingest = table.ingest!;
  const source = tableSources.find((item) => item.id === ingest.connection.connector)!;
  const problems = connectionProblems(source, ingest.connection.settings);
  const parts = source.object.length > 1 ? ingest.object.split(".") : [ingest.object];
  if (invalidParts(parts, source))
    problems.push(
      `the source object must be ${source.object.join(".") || "a non-empty result name"}`,
    );
  if (/[\\@]|(^|[/.])\.\.([/.]|$)|^\//.test(ingest.object))
    problems.push("the source object must not contain paths or expressions");
  if (ingest.settings.query !== undefined && !source.query)
    problems.push("this connector does not support a query setting");
  if (source.queryRequired && !nonEmpty(ingest.settings.query))
    problems.push('this connector needs "query" in ingest.with');
  problems.push(...sourceOptionProblems(table, source));
  return problems;
}

function invalidParts(parts: string[], source: TableSource): boolean {
  return (
    !parts.every(nonEmpty) || (source.object.length > 1 && parts.length !== source.object.length)
  );
}

function sourceCategory(source: (typeof tableSources)[number]): string {
  if (tableSap.includes(source)) return "SAP";
  if (tableApps.includes(source) || tableCrm.includes(source) || source.id === "microsoft-365")
    return "Business applications";
  if (tableProtocols.includes(source) || source.id === "web-table") return "APIs and protocols";
  return "Databases and analytics";
}
