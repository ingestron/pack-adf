// The adf-files method: a Data Factory copy that moves files from a share the
// data platform cannot reach into a landing folder as they are, so the
// platform reads them with their own format.
import { needsVault } from "./vault.js";
import { webRequestSettings, httpOptionProblems } from "./web-options.js";
import { fileStores } from "./file-sources.js";
import { connectionProblems } from "./connection-check.js";
import { filesOutput } from "./landing-output.js";
import type { Method, ResolvedTable } from "@ingestron/definitions";
import { credentialProblems, placement, windowSettings } from "./method.js";

/** Copies files from a share with Azure Data Factory into a landing folder. */
export const adfFiles: Method = {
  action: "ingest",
  description:
    "Azure Data Factory copies files from a share through a self-hosted integration runtime into a landing folder as they are.",
  connectors: ["files", ...fileStores.map((source) => source.id)],
  connectivity: ["private", "workspace", "public"],
  produces: "files",
  placement,
  defaults: {
    runtime_kind: "self-hosted",
    mode: "new",
    files: "*",
    options: {},
    schema_hints: true,
    every: { frequency: "Hour", interval: 24 },
    retries: 2,
  },
  settings: {
    type: "object",
    additionalProperties: false,
    required: ["landing", "integration_runtime", "start", "format"],
    properties: {
      ...windowSettings,
      source_options: {
        type: "object",
        additionalProperties: false,
        description: "HTTP download request options; other file sources reject these options.",
        properties: webRequestSettings,
      },
      runtime_kind: {
        enum: ["azure", "self-hosted"],
        enumDescriptions: [
          "An Azure integration runtime.",
          "A self-hosted integration runtime with the required drivers and network access.",
        ],
        description:
          "Kind of the named integration runtime. File System and HDFS require self-hosted.",
      },
      format: {
        enum: ["parquet", "csv", "json", "avro", "orc", "xml", "text"],
        enumDescriptions: [
          "Parquet files.",
          "CSV text; set options such as header: true.",
          "JSON, one object per line unless options say otherwise.",
          "Avro files.",
          "ORC files.",
          "XML; set options such as rowTag.",
          "Each line as one row.",
        ],
        description: "The files' format, for the platform that reads them.",
      },
      options: {
        type: "object",
        description: "Options for reading the files, such as header: true for CSV.",
      },
      schema_hints: {
        type: "boolean",
        description:
          "Pass the contract's column types to the reader, so CSV and JSON columns are typed.",
      },
      files: {
        type: "string",
        description: "Which files in the folder and its subfolders to copy, with * and ?.",
        examples: ["*.csv"],
      },
      mode: {
        enum: ["new", "all"],
        enumDescriptions: ["Files changed in the window.", "Every file, each window."],
        description: "Which files each window copies.",
      },
    },
  },
  check: checkFiles,
  output: filesOutput,
};

function checkFiles(table: ResolvedTable): string[] {
  const connection = table.ingest!.connection;
  const source = fileStores.find((item) => item.id === connection.connector);
  const problems = source
    ? connectionProblems(source, connection.settings)
    : credentialProblems(table, ["path", "user"]);
  problems.push(...fileOptionsProblems(table), ...httpOptionProblems(table));
  if (
    needsVault([connection.settings, table.ingest!.settings]) &&
    !table.ingest!.settings.key_vault
  )
    problems.push("secret references require key_vault in the adf-files settings");
  if (!source)
    problems.push(
      ...Object.keys(connection.settings)
        .filter((key) => !["path", "user", "password"].includes(key))
        .map((key) => `the connection setting "${key}" is not supported for files`),
    );
  const object = table.ingest?.object ?? "";
  if (!object.trim() || object.split("/").some((part) => part === "." || part === ""))
    problems.push("the source object must be a non-empty relative path");
  if (/^[\\/]|\\|@|(^|\/)\.\.(\/|$)/.test(object))
    problems.push(`a files object is a folder under the share written with "/", not "${object}"`);
  return problems;
}

function fileOptionsProblems(table: ResolvedTable): string[] {
  const connection = table.ingest!.connection;
  const problems: string[] = [];
  const settings = table.ingest!.settings;
  if (["ftp", "http"].includes(connection.connector) && settings.mode !== "all")
    problems.push(
      `${connection.connector} requires mode: all; native modified-time filtering is unavailable`,
    );
  if (
    connection.connector === "http" &&
    (!settings.files || /[?*\\/@]/.test(String(settings.files)))
  )
    problems.push("HTTP requires files to name one output file without wildcards");
  if (["files", "hdfs"].includes(connection.connector) && settings.runtime_kind !== "self-hosted")
    problems.push(`${connection.connector} requires runtime_kind: self-hosted`);
  return problems;
}
