// Turns the tables copied with adf-copy and adf-files into ADF resource files, path → JSON.
import { resourceName } from "./resource-names.js";
import { addResource, mergeResources } from "./resource-files.js";
import { tableGroups, tableResources } from "./table-resources.js";
import type { ResolvedModel, ResolvedTable } from "@ingestron/definitions";
import {
  fileServerService,
  filesPipeline,
  landingFilesDataset,
  shareDataset,
  type FilesGroup,
} from "./files-resources.js";
import {
  copyPipeline,
  keyVaultService,
  landingDataset,
  landingService,
  sourceDataset,
  sqlServerService,
  windowTrigger,
  type CopyGroup,
  type Shared,
} from "./resources.js";

/**
 * Every ADF resource file for one environment, in ADF's Git folder layout.
 * @example
 * const files = build(model); // { "pipeline/pl_erp_erp.json": "{…}", … }
 */
export function build(model: ResolvedModel): Record<string, string> {
  const copies = copyGroups(model);
  const shares = filesGroups(model);
  const native = tableGroups(model);
  const all = [...copies, ...shares, ...native.map((tables) => ({ tables }))];
  if (!all.length) return {};
  const first = all[0]!.tables[0]!.ingest!.settings;
  const project = model.project.id;
  const shared = sharedNames(
    project,
    all.flatMap((group) => group.tables),
  );
  const files: Record<string, string> = {};
  const add = (folder: string, resource: { name?: unknown }) =>
    addResource(files, folder, resource);
  if (first.key_vault) add("linkedService", keyVaultService(shared, String(first.key_vault)));
  add("linkedService", landingService(shared, String(first.landing)));
  if (copies.length > 0 || native.length > 0)
    add("dataset", landingDataset(shared, String(first.landing)));
  if (shares.length > 0) add("dataset", landingFilesDataset(shared, String(first.landing)));
  if (shares.some((group) => group.connection.connector === "http"))
    add("dataset", landingFilesDataset(shared, String(first.landing), true));
  copyResources(model, copies, shared, files);
  for (const group of shares) {
    const name = `${project}_${group.connection.id}`;
    add("linkedService", fileServerService(group, shared, group.tables[0]!.ingest!.settings));
    add("dataset", shareDataset(group));
    const pipeline = resourceName(group.tables, "pipeline", `pl_${name}`);
    add("pipeline", filesPipeline(model, group, shared, pipeline));
    add(
      "trigger",
      windowTrigger(model, group, pipeline, resourceName(group.tables, "trigger", `tr_${name}`)),
    );
  }
  mergeResources(files, tableResources(model, shared));
  return files;
}

function copyResources(
  model: ResolvedModel,
  copies: CopyGroup[],
  shared: Shared,
  files: Record<string, string>,
): void {
  const project = model.project.id;
  const add = (folder: string, resource: { name?: unknown }) =>
    addResource(files, folder, resource);
  for (const group of copies) {
    const settings = group.tables[0]!.ingest!.settings;
    const name = `${project}_${group.connection.id}${group.database === group.connection.id ? "" : `_${group.database}`}`;
    add("linkedService", sqlServerService(group, shared, settings));
    add("dataset", sourceDataset(group));
    const pipeline = resourceName(group.tables, "pipeline", `pl_${name}`);
    add("pipeline", copyPipeline(model, group, shared, pipeline));
    add(
      "trigger",
      windowTrigger(model, group, pipeline, resourceName(group.tables, "trigger", `tr_${name}`)),
    );
  }
}

/** Tables copied with adf-files, grouped by connection: one share, one pipeline. */
export function filesGroups(model: ResolvedModel): FilesGroup[] {
  const groups = new Map<string, FilesGroup>();
  for (const table of model.tables.filter(
    (candidate) => candidate.ingest?.method === "adf-files",
  )) {
    const connection = table.ingest!.connection;
    const names = `${model.project.id}_${connection.id}`;
    const group = groups.get(connection.id) ?? {
      connection,
      tables: [] as ResolvedTable[],
      linkedService: `ls_${names}`,
      dataset: `ds_${names}`,
    };
    group.tables.push(table);
    groups.set(connection.id, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    linkedService: resourceName(group.tables, "source_linked_service", group.linkedService),
    dataset: resourceName(group.tables, "source_dataset", group.dataset),
  }));
}

/** Tables copied with adf-copy, grouped by connection and source database. */
export function copyGroups(model: ResolvedModel): CopyGroup[] {
  const groups = new Map<string, CopyGroup>();
  for (const table of model.tables.filter((candidate) => candidate.ingest?.method === "adf-copy")) {
    const connection = table.ingest!.connection;
    const database = table.ingest!.object.split(".")[0] ?? "";
    const key = `${connection.id}.${database}`;
    const names = `${model.project.id}_${connection.id}_${database}`;
    const group = groups.get(key) ?? {
      connection,
      database,
      tables: [] as ResolvedTable[],
      linkedService: `ls_${names}`,
      dataset: `ds_${names}`,
    };
    group.tables.push(table);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    linkedService: resourceName(group.tables, "source_linked_service", group.linkedService),
    dataset: resourceName(group.tables, "source_dataset", group.dataset),
  }));
}

function sharedNames(project: string, tables: ResolvedTable[]): Shared {
  const files = tables.filter((table) => table.ingest!.method === "adf-files");
  const native = tables.filter((table) => table.ingest!.method !== "adf-files");
  const http = files.filter((table) => table.ingest!.connection.connector === "http");
  return {
    keyVault: resourceName(tables, "key_vault_linked_service", `ls_${project}_keyvault`),
    landing: resourceName(tables, "landing_linked_service", `ls_${project}_landing`),
    landingDataset: resourceName(native, "landing_dataset", `ds_${project}_landing`),
    landingFiles: resourceName(files, "landing_files_dataset", `ds_${project}_landing_files`),
    landingHttp: resourceName(http, "landing_http_dataset", `ds_${project}_landing_files_http`),
  };
}
