// Additional native file stores use the same binary datasets and copy windows.
import type { Connector } from "@ingestron/definitions";
import { fileStores } from "./file-sources.js";
import { nativeValue } from "./sql-auth.js";
import { reference, type Shared } from "./resources.js";
import type { FilesGroup } from "./files-resources.js";

/** Connector facts for the file sources beyond the original file share. */
export const nativeFileConnectors: Connector[] = fileStores.map((source) => ({
  id: source.id,
  title: source.title,
  category: source.id === "http" ? "APIs and protocols" : "Files and storage",
  method: "adf-files",
  object: source.root ? `${source.root}/folder` : "a relative folder",
  settings: Object.entries(source.fields).map(([name, field]) => ({
    name,
    description: field.description,
    ...(field.secret && { secret: true }),
    ...(field.optional && { optional: true }),
    ...(field.number && { type: "number" as const }),
    ...(field.secretMap && { type: "object" as const }),
    ...(field.values && { values: field.values }),
  })),
  generates: `a ${source.service} linked service, a binary copy pipeline and a tumbling window trigger`,
  maturity: { status: "GA", checked: "2026-10-28" },
  docs: `https://learn.microsoft.com/en-us/azure/data-factory/connector-${source.docs}`,
}));

/** The native linked service for a validated file-store connection. */
export function nativeFileService(
  group: FilesGroup,
  shared: Shared,
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const source = fileStores.find((item) => item.id === group.connection.connector)!;
  const typeProperties: Record<string, unknown> = { ...source.defaults };
  for (const [key, field] of Object.entries(source.fields)) {
    const value = group.connection.settings[key];
    if (value !== undefined)
      typeProperties[field.native] = nativeValue(value, field, shared.keyVault);
  }
  return {
    name: group.linkedService,
    properties: {
      type: source.service,
      typeProperties,
      ...(settings.runtime_kind === "azure" &&
      settings.integration_runtime === "AutoResolveIntegrationRuntime"
        ? {}
        : {
            connectVia: reference(
              String(settings.integration_runtime),
              "IntegrationRuntimeReference",
            ),
          }),
    },
  };
}

/** Native location with a parameter for the container/bucket when required. */
export function nativeFileLocation(connector: string): Record<string, unknown> {
  const source = fileStores.find((item) => item.id === connector)!;
  if (connector === "http")
    return {
      type: source.location,
      relativeUrl: { value: "@dataset().folder", type: "Expression" },
    };
  return {
    type: source.location,
    ...(source.root && { [source.root]: { value: "@dataset().root", type: "Expression" } }),
    folderPath: { value: "@dataset().folder", type: "Expression" },
  };
}

/** Dataset parameters, splitting a container/bucket from its relative folder. */
export function nativeFileParameters(connector: string, object: string): Record<string, string> {
  const source = fileStores.find((item) => item.id === connector);
  if (!source?.root)
    return { folder: connector === "files" ? object.replaceAll("/", "\\") : object };
  const [root = "", ...parts] = object.split("/");
  return { root, folder: parts.join("/") };
}
