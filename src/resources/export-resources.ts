// Export-only resources are built from the same definitions and Key Vault references.
import { resourceName } from "../factory/resource-names.js";
import type { ResolvedTable } from "@ingestron/definitions";
import { parseLanding } from "../design/landing.js";
import { reference, type Shared } from "./resources.js";
import { vaultSecret } from "../connection/sql-auth.js";
import type { TableSource } from "../connection/table-source.js";
type Data = Record<string, unknown>;
/** Additional resources for staged exports and Microsoft 365's landing. */
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

/** A binary dataset of a folder: Microsoft writes the JSON files and names them. */
function officeDataset(tables: ResolvedTable[], name: string, fileSystem: string): Data {
  const service = resourceName(tables, "json_landing_linked_service", `ls_${name}_json`);
  return {
    name: resourceName(tables, "json_landing_dataset", `ds_${name}_json`),
    properties: {
      type: "Binary",
      linkedServiceName: reference(service, "LinkedServiceReference"),
      parameters: { folder: { type: "string" } },
      typeProperties: {
        location: {
          type: "AzureBlobFSLocation",
          fileSystem,
          folderPath: { value: "@dataset().folder", type: "Expression" },
        },
      },
    },
  };
}
