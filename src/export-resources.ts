// Export-only resources are built from the same definitions and Key Vault references.
import { resourceName } from "./resource-names.js";
import type { ResolvedTable } from "@ingestron/definitions";
import { parseLanding } from "./landing.js";
import { layoutOf } from "./layout.js";
import { reference, type Shared } from "./resources.js";
import { vaultSecret } from "./sql-auth.js";
import type { TableSource } from "./table-source.js";
type Data = Record<string, unknown>;
/** Additional resources for staged exports and Microsoft 365 JSON landing. */
export function exportResources(
  tables: ResolvedTable[],
  source: TableSource,
  shared: Shared,
  name: string,
): [string, Data][] {
  const table = tables[0]!;
  const ingest = table.ingest!;
  const options = (ingest.settings.source_options ?? {}) as Data;
  if (source.staged)
    return [
      [
        "linkedService",
        {
          name: resourceName(tables, "staging_linked_service", `ls_${name}_staging`),
          properties: {
            type: "AzureBlobStorage",
            typeProperties: { sasUri: vaultSecret(options.staging_sas, shared.keyVault) },
            connectVia: reference(
              String(ingest.settings.integration_runtime),
              "IntegrationRuntimeReference",
            ),
          },
        },
      ],
    ];
  if (source.id !== "microsoft-365") return [];
  return officeResources(tables, shared, name);
}
function officeResources(tables: ResolvedTable[], shared: Shared, name: string): [string, Data][] {
  const table = tables[0]!;
  const ingest = table.ingest!;
  const credentials = ingest.connection.settings;
  const { url, fileSystem } = parseLanding(String(ingest.settings.landing));
  return [
    [
      "linkedService",
      {
        name: resourceName(tables, "json_landing_linked_service", `ls_${name}_json`),
        properties: {
          type: "AzureBlobFS",
          typeProperties: {
            url,
            tenant: credentials.application_tenant,
            servicePrincipalId: credentials.client_id,
            servicePrincipalKey: vaultSecret(credentials.client_secret, shared.keyVault),
          },
        },
      },
    ],
    ["dataset", officeDataset(tables, name, fileSystem)],
  ];
}

function officeDataset(tables: ResolvedTable[], name: string, fileSystem: string): Data {
  const service = resourceName(tables, "json_landing_linked_service", `ls_${name}_json`);
  // Files are named unless every table lands increments, which ADF names itself.
  const named = tables.some((table) => layoutOf(table) !== "increments");
  return {
    name: resourceName(tables, "json_landing_dataset", `ds_${name}_json`),
    properties: {
      type: "Json",
      linkedServiceName: reference(service, "LinkedServiceReference"),
      parameters: named
        ? { folder: { type: "string" }, file: { type: "string" } }
        : { folder: { type: "string" } },
      typeProperties: {
        location: {
          type: "AzureBlobFSLocation",
          fileSystem,
          folderPath: { value: "@dataset().folder", type: "Expression" },
          ...(named && { fileName: { value: "@dataset().file", type: "Expression" } }),
        },
      },
    },
  };
}
