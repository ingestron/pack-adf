// The adf-copy method: a Data Factory copy that lands Parquet files where the
// data platform reads them, for sources the platform cannot reach.
import type { Method, ResolvedTable } from "@ingestron/definitions";

import { afterCopySchema } from "./after-copy-settings.js";
import { designPlacement, designSettings, fileDesignSettings } from "./design-settings.js";
import { resourceNamesSchema } from "./resource-names.js";
import { runtimeName, runtimeSchema } from "./runtimes.js";
import { sqlTypes } from "./sql-types.js";
import { sqlConnectionProblems, nonEmpty } from "./sql-auth.js";
import { layoutProblems, tableOutput } from "./landing-output.js";
import { datedPath } from "./layout.js";

const abfss = "^abfss://[^@/]+@[^/]+\\.dfs\\.core\\.windows\\.net(/.*)?$";

/** Settings every ADF copy has: where it lands, how it reaches the source, and its windows. */
export const windowSettings = {
  resource_names: resourceNamesSchema,
  landing: {
    type: "string",
    pattern: abfss,
    description: "Landing folder, abfss://<container>@<account>.dfs.core.windows.net/<path>.",
    examples: ["abfss://landing@erplake.dfs.core.windows.net/erp"],
    find: "Azure portal: Storage accounts, the account, then Data storage, Containers.",
  },
  integration_runtime: runtimeName,
  runtime: runtimeSchema,
  key_vault: {
    type: "string",
    pattern: "^https://[^/]+\\.vault\\.azure\\.net/?$",
    description: "Key Vault holding the source's secrets.",
    examples: ["https://kv-erp.vault.azure.net"],
    find: "Azure portal: Key vaults; the vault's name is in its URI, https://<name>.vault.azure.net.",
  },
  every: {
    type: "object",
    additionalProperties: false,
    required: ["frequency", "interval"],
    properties: {
      frequency: {
        enum: ["Minute", "Hour", "Month"],
        enumDescriptions: [
          "Windows counted in minutes.",
          "Windows counted in hours.",
          "Windows counted in months.",
        ],
        description: "What the interval counts.",
      },
      interval: {
        type: "integer",
        minimum: 1,
        description: "How many make one window, such as 24 hours.",
      },
    },
    description: "Window size. Tumbling windows count in minutes, hours or months.",
  },
  start: {
    type: "string",
    description: "Start of the first window (UTC), such as 2026-10-01T00:00:00Z.",
    examples: ["2026-10-01T00:00:00Z"],
  },
  retries: {
    type: "integer",
    minimum: 0,
    description: "How often a failed window is tried again, five minutes apart.",
  },
  after_copy: afterCopySchema,
  paused: {
    type: "boolean",
    description:
      "Keep the trigger stopped. Default: the platform's `schedule.paused`, so it pauses with the Databricks job; without a schedule, stopped unless the environment is named `prod` or `production`.",
  },
};

/** Shared infrastructure belongs in the platform, the schedule in the standard. */
export const placement = {
  platform: [
    "landing",
    "integration_runtime",
    "runtime_kind",
    "runtime",
    "key_vault",
    "paused",
    "after_copy",
  ],
  standard: ["every", "start", "retries", "resource_names", ...Object.keys(fileDesignSettings)],
};

/** Where the tabular methods' settings belong: layouts are a standard's choice. */
export const tablePlacement = {
  platform: placement.platform,
  standard: [...new Set([...placement.standard, ...designPlacement, "layout", "path"])],
};

/** How the tabular methods lay out each table's files in the landing folder. */
export const layoutSettings = {
  layout: {
    enum: ["snapshot", "increments"],
    enumDescriptions: [
      "One file per table, `<object>/<object>.parquet` (`.json` for Microsoft 365), replaced by each run, so a report reads the same path after every load.",
      "A new file per run under `<object>/`, named by the window's start and the run, so no run replaces another's rows.",
    ],
    description:
      "How each table's files are laid out in the landing folder. Without it, a flow that ends at the landed files gets `snapshot`, unless its runs hold only their window's rows (`mode: incremental`, or a Microsoft 365 date filter); every other flow gets `increments`. `snapshot` for runs that hold only their window's rows is refused, unless a store reads each file before the next run replaces it.",
  },
  path: {
    type: "string",
    description:
      "A path of your own for each table's file under the landing folder, instead of `layout`. It must include `{object}` and end in `.parquet` (`.json` for Microsoft 365). Its other tokens are `{connection}`, the window start's `{yyyy}`, `{MM}`, `{dd}` and `{HH}`, and `{run}`. A run adds a file when the path has `{run}`, or the date tokens down to the window's unit, such as `{HH}` for hourly windows; otherwise it replaces the file. Setting `path` and `layout` in the same place is refused; set in different places, the one nearer the table wins.",
    examples: ["{object}/{yyyy}/{MM}/{dd}/{object}_{run}.parquet"],
  },
};

/** Problems with a connection that signs in with a user and a Key Vault password. */
export function credentialProblems(table: ResolvedTable, keys: string[]): string[] {
  const settings = table.ingest?.connection.settings ?? {};
  const password = settings.password as { $secret?: unknown } | undefined;
  const problems =
    typeof password?.$secret === "string"
      ? []
      : ["the connection's password must be ${secret:…}, the name of a Key Vault secret"];
  for (const key of keys)
    if (typeof settings[key] !== "string") problems.push(`the connection needs "settings.${key}"`);
  return problems;
}

/** Copies tables with Azure Data Factory into a landing folder. */
export const adfCopy: Method = {
  action: "ingest",
  description:
    "Azure Data Factory copies the table from a supported SQL Server family source through the named integration runtime into a landing folder as Parquet.",
  connectors: Object.keys(sqlTypes),
  connectivity: ["private", "workspace", "public"],
  produces: "files",
  renames: true,
  placement: tablePlacement,
  defaults: {
    format: "parquet",
    runtime_kind: "self-hosted",
    mode: "full",
    every: { frequency: "Hour", interval: 24 },
    retries: 2,
    encrypt: "mandatory",
  },
  settings: {
    type: "object",
    additionalProperties: false,
    required: ["landing", "integration_runtime", "runtime_kind", "key_vault", "start"],
    properties: {
      ...windowSettings,
      ...layoutSettings,
      ...designSettings,
      runtime_kind: {
        enum: ["azure", "self-hosted"],
        enumDescriptions: [
          "An Azure integration runtime.",
          "A self-hosted integration runtime with the required drivers and network access.",
        ],
        description:
          "Kind of the named integration runtime. Windows authentication requires self-hosted.",
      },
      format: {
        enum: ["parquet"],
        description: "Files are written as Parquet; the platform reads this.",
      },
      mode: {
        enum: ["full", "incremental"],
        enumDescriptions: [
          "The whole table, each window.",
          "Only rows changed in the window, by watermark_column.",
        ],
        description: "What each window copies.",
      },
      watermark_column: {
        type: "string",
        description: "Incremental: the column that records when a row changed.",
        examples: ["modified_at"],
      },
      encrypt: {
        enum: ["mandatory", "optional", "strict"],
        enumDescriptions: [
          "Encrypt, and check the server's certificate.",
          "Encrypt when the server supports it.",
          "TDS 8.0: encrypt everything, the login included, and check the certificate.",
        ],
        description: "TLS for the SQL Server connection.",
      },
    },
  },
  check: checkCopy,
  output: tableOutput,
};

function checkCopy(table: ResolvedTable): string[] {
  const ingest = table.ingest;
  if (!ingest) return [];
  const problems = [...sqlConnectionProblems(table), ...layoutProblems(table)];
  if (ingest.object.split(".").length !== 3 || !ingest.object.split(".").every(nonEmpty))
    problems.push(
      `a ${ingest.connection.connector} object is written database.schema.table, not "${ingest.object}"`,
    );
  if (ingest.settings.pattern === "foreach" && datedPath(table))
    problems.push("use pattern: activities for a path with date or run tokens");
  if (
    ingest.settings.mode === "incremental" &&
    typeof ingest.settings.watermark_column !== "string"
  ) {
    problems.push('incremental mode needs "watermark_column"');
  }
  return problems;
}
