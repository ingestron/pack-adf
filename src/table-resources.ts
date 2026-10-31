// Ordinary native table copies: concrete connector facts supply only documented properties.
import { resourceName } from "./resource-names.js";
import type { ResolvedModel, ResolvedTable } from "@ingestron/definitions";
import { addResource } from "./resource-files.js";
import { nativeSource, stagingOptions, tableTranslator } from "./table-copy-options.js";
import { exportResources } from "./export-resources.js";
import { parseLanding } from "./landing.js";
import { tableSources } from "./table-method.js";
import { nativeValue } from "./sql-auth.js";
import { reference, windowTrigger, type Shared } from "./resources.js";
import type { TableSource } from "./table-source.js";
type Data = Record<string, unknown>;

/** Resource files for native table sources, using one pipeline and linked service per connection. */
export function tableResources(model: ResolvedModel, shared: Shared): Record<string, string> {
  const files: Record<string, string> = {};
  for (const tables of tableGroups(model)) {
    const first = tables[0]!;
    const source = tableSources.find((item) => item.id === first.ingest!.connection.connector)!;
    const name = `${model.project.id}_${first.ingest!.connection.id}`;
    const service = resourceName(tables, "source_linked_service", `ls_${name}`);
    const pipeline = resourceName(tables, "pipeline", `pl_${name}`);
    const dataset = (table: ResolvedTable) =>
      resourceName(table, "source_dataset", `ds_${name}_${table.name}`);
    const add = (folder: string, resource: Data) => addResource(files, folder, resource);
    for (const [folder, resource] of exportResources(tables, source, shared, name))
      add(folder, resource);
    add("linkedService", tableService(first, source, shared, service));
    for (const table of tables)
      add("dataset", tableDataset(table, source, service, dataset(table)));
    add("pipeline", {
      name: pipeline,
      properties: {
        parameters: { windowStart: { type: "string" }, windowEnd: { type: "string" } },
        activities: tables.map((table) =>
          tableActivity(table, source, shared, dataset(table), name),
        ),
      },
    });
    add(
      "trigger",
      windowTrigger(model, { tables }, pipeline, resourceName(tables, "trigger", `tr_${name}`)),
    );
  }
  return files;
}

/** Tables sharing a connection also share its runtime and schedule. */
export function tableGroups(model: ResolvedModel): ResolvedTable[][] {
  const groups = new Map<string, ResolvedTable[]>();
  for (const table of model.tables.filter((item) => item.ingest?.method === "adf-table")) {
    const id = table.ingest!.connection.id;
    const group = groups.get(id) ?? [];
    group.push(table);
    groups.set(id, group);
  }
  return [...groups.values()];
}

function tableService(
  table: ResolvedTable,
  source: TableSource,
  shared: Shared,
  name: string,
): Data {
  const ingest = table.ingest!;
  const properties: Data = { ...source.defaults };
  for (const [key, field] of Object.entries(source.fields)) {
    const value = ingest.connection.settings[key];
    if (value !== undefined) properties[field.native] = nativeValue(value, field, shared.keyVault);
  }
  return {
    name,
    properties: {
      type: source.service,
      ...(source.version && { version: source.version }),
      typeProperties: properties,
      connectVia: reference(
        String(ingest.settings.integration_runtime),
        "IntegrationRuntimeReference",
      ),
    },
  };
}

function tableDataset(
  table: ResolvedTable,
  source: TableSource,
  service: string,
  name: string,
): Data {
  const parts = source.object.length > 1 ? table.ingest!.object.split(".") : [table.ingest!.object];
  const typeProperties: Data = Object.fromEntries(
    source.object.map((key, index) => [key, parts[index]]),
  );
  const options = (table.ingest!.settings.source_options ?? {}) as Data;
  if (source.id === "web-table") typeProperties.index = options.table_index;
  if (source.id === "fabric-lakehouse" && options.schema) typeProperties.schema = options.schema;
  return {
    name,
    properties: {
      type: source.dataset,
      linkedServiceName: reference(service, "LinkedServiceReference"),
      typeProperties,
    },
  };
}

function tableActivity(
  table: ResolvedTable,
  source: TableSource,
  shared: Shared,
  dataset: string,
  name: string,
): Data {
  const options = (table.ingest!.settings.source_options ?? {}) as Data;
  return {
    name: resourceName(table, "copy_activity", `copy_${table.name}`),
    type: "Copy",
    inputs: [reference(dataset, "DatasetReference")],
    outputs: [tableOutput(table, source, shared, name)],
    typeProperties: {
      source: nativeSource(table, source),
      sink: tableSink(source),
      ...(source.staged
        ? stagingOptions(
            source,
            resourceName(table, "staging_linked_service", `ls_${name}_staging`),
            options.staging_path,
          )
        : {}),
      ...tableTranslator(table, source),
    },
  };
}

function tableOutput(
  table: ResolvedTable,
  source: TableSource,
  shared: Shared,
  name: string,
): Data {
  const ingest = table.ingest!;
  const { path } = parseLanding(String(ingest.settings.landing));
  const office = source.id === "microsoft-365";
  const folder = [path, ingest.object].filter(Boolean).join("/");
  return office
    ? {
        ...reference(
          resourceName(table, "json_landing_dataset", `ds_${name}_json`),
          "DatasetReference",
        ),
        parameters: { folder },
      }
    : {
        ...reference(shared.landingDataset, "DatasetReference"),
        parameters: {
          folder,
          file: "@{concat(formatDateTime(pipeline().parameters.windowStart, 'yyyyMMddHHmmss'), '_', pipeline().RunId, '.parquet')}",
        },
      };
}

function tableSink(source: TableSource): Data {
  const office = source.id === "microsoft-365";
  return {
    type: office ? "JsonSink" : "ParquetSink",
    storeSettings: {
      type: "AzureBlobFSWriteSettings",
      ...(source.staged && { copyBehavior: "MergeFiles" }),
    },
    formatSettings: {
      type: office ? "JsonWriteSettings" : "ParquetWriteSettings",
      ...(office && { filePattern: "setOfObjects" }),
    },
  };
}
