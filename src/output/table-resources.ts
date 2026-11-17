// Ordinary native table copies: concrete connector facts supply only documented properties.
import { transportAuthentication } from "../connection/index.js";
import { resourceName } from "../factory/index.js";
import type { ResolvedModel, ResolvedTable } from "@ingestron/definitions";
import { addResource } from "../factory/index.js";
import { exportResources } from "../resources/index.js";
import { tableSources } from "../methods/index.js";
import { nativeValue } from "../connection/index.js";
import { reference, windowTrigger, type Shared } from "../resources/index.js";
import { flowSuffix, flowTriggers, groupKey, onceFor } from "./groups.js";
import type { FlowPipeline } from "../triggers/index.js";
import { tablePipeline } from "./table-pipeline.js";
import type { TableSource } from "../connection/index.js";
type Data = Record<string, unknown>;

/**
 * Resource files for native table sources, using one pipeline and linked service per connection.
 * A flow that writes triggers gets none here: its pipeline is added to `flows` for them.
 */
export function tableResources(
  model: ResolvedModel,
  shared: Shared,
  flows: FlowPipeline[] = [],
): Record<string, string> {
  const files: Record<string, string> = {};
  const seen = new Map<string, string>();
  for (const tables of tableGroups(model)) {
    const first = tables[0]!;
    const source = tableSources.find((item) => item.id === first.ingest!.connection.connector)!;
    const name = `${model.project.id}_${first.ingest!.connection.id}`;
    const own = `${name}${flowSuffix(tables)}`;
    const service = resourceName(tables, "source_linked_service", `ls_${name}`);
    const pipeline = resourceName(tables, "pipeline", `pl_${own}`);
    const dataset = (table: ResolvedTable) =>
      resourceName(table, "source_dataset", `ds_${name}_${table.name}`);
    const add = (folder: string, resource: Data) => addResource(files, folder, resource);
    const share = onceFor(seen, first.ingest!.connection.id, add);
    for (const [folder, resource] of exportResources(tables, source, shared, name))
      share(folder, resource);
    share("linkedService", tableService(first, source, shared, service));
    for (const table of tables)
      add("dataset", tableDataset(table, source, service, dataset(table)));
    add("pipeline", tablePipeline(model, tables, source, shared, { name, pipeline, dataset }));
    const triggers = flowTriggers(tables);
    if (triggers.length > 0) flows.push({ pipeline, triggers });
    else
      add(
        "trigger",
        windowTrigger(model, { tables }, pipeline, resourceName(tables, "trigger", `tr_${own}`)),
      );
  }
  return files;
}

/** Tables sharing a connection also share its runtime and schedule. */
export function tableGroups(model: ResolvedModel): ResolvedTable[][] {
  const groups = new Map<string, ResolvedTable[]>();
  for (const table of model.tables.filter((item) => item.ingest?.method === "adf-table")) {
    const key = groupKey(table);
    const group = groups.get(key) ?? [];
    group.push(table);
    groups.set(key, group);
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
  const authentication = transportAuthentication(source, ingest.connection.settings);
  if (authentication) properties.authenticationType = authentication;
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
