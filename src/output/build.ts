// Turns the tables copied with adf-copy and adf-files into ADF resource files, path → JSON.
import { afterCopy } from "../design/index.js";
import { decorate, withOperations } from "../design/index.js";
import { foreachPipeline } from "../resources/index.js";
import { resourceName } from "../factory/index.js";
import { addCredentials } from "../factory/index.js";
import { addRuntimes } from "../factory/index.js";
import { addResource, checkNameLengths, mergeResources } from "../factory/index.js";
import { tableGroups, tableResources } from "./table-resources.js";
import { flowSuffix, flowTriggers, onceFor } from "./groups.js";
import { copyGroups, copyName, filesGroups } from "./source-groups.js";
import { addFlowTriggers, type FlowPipeline } from "../triggers/index.js";
import type { ResolvedModel, ResolvedTable } from "@ingestron/definitions";
import {
  fileServerService,
  filesPipeline,
  landingFilesDataset,
  shareDataset,
  type FilesGroup,
} from "../resources/index.js";
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
} from "../resources/index.js";

/**
 * Every ADF resource file for one environment, in ADF's Git folder layout, with the
 * integration runtimes and credentials its linked services use.
 * @example
 * const files = build(model); // { "pipeline/pl_erp_erp.json": "{…}", … }
 */
export function build(given: ResolvedModel): Record<string, string> {
  const model = withOperations(given);
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
  const flows: FlowPipeline[] = [];
  copyResources(model, copies, shared, files, flows);
  shareResources(model, shares, shared, files, flows);
  mergeResources(files, tableResources(model, shared, flows));
  addFactoryWide(files, model, addFlowTriggers(model, flows, add));
  return files;
}

/**
 * What reads the whole factory: the after-copy parent, design, runtimes and credentials, and the
 * name limits. `flowTriggers` names the triggers flows write.
 */
function addFactoryWide(
  files: Record<string, string>,
  model: ResolvedModel,
  flowTriggers: ReadonlySet<string>,
): void {
  afterCopy(files, model, flowTriggers);
  decorate(files, model);
  addRuntimes(files, model);
  addCredentials(files, model);
  checkNameLengths(files);
}

function copyResources(
  model: ResolvedModel,
  copies: CopyGroup[],
  shared: Shared,
  files: Record<string, string>,
  flows: FlowPipeline[],
): void {
  const add = (folder: string, resource: { name?: unknown }) =>
    addResource(files, folder, resource);
  const seen = new Map<string, string>();
  for (const group of copies) {
    const settings = group.tables[0]!.ingest!.settings;
    const name = `${copyName(model.project.id, group)}${flowSuffix(group.tables)}`;
    const share = onceFor(seen, `${group.connection.id}.${group.database}`, add);
    share("linkedService", sqlServerService(group, shared, settings));
    share("dataset", sourceDataset(group));
    const pipeline = resourceName(group.tables, "pipeline", `pl_${name}`);
    add(
      "pipeline",
      settings.pattern === "foreach"
        ? foreachPipeline(model, group, shared, pipeline)
        : copyPipeline(model, group, shared, pipeline),
    );
    addTrigger(model, group, pipeline, `tr_${name}`, { add, flows });
  }
}

/** The group's default trigger, or, for a flow that writes its own, the pipeline they start. */
function addTrigger(
  model: ResolvedModel,
  group: { tables: ResolvedTable[] },
  pipeline: string,
  name: string,
  to: { add: (folder: string, resource: { name?: unknown }) => void; flows: FlowPipeline[] },
): void {
  const triggers = flowTriggers(group.tables);
  if (triggers.length > 0) to.flows.push({ pipeline, triggers });
  else
    to.add(
      "trigger",
      windowTrigger(model, group, pipeline, resourceName(group.tables, "trigger", name)),
    );
}

function shareResources(
  model: ResolvedModel,
  shares: FilesGroup[],
  shared: Shared,
  files: Record<string, string>,
  flows: FlowPipeline[],
): void {
  const project = model.project.id;
  const add = (folder: string, resource: { name?: unknown }) =>
    addResource(files, folder, resource);
  const seen = new Map<string, string>();
  for (const group of shares) {
    const name = `${project}_${group.connection.id}`;
    const own = `${name}${flowSuffix(group.tables)}`;
    const share = onceFor(seen, group.connection.id, add);
    share("linkedService", fileServerService(group, shared, group.tables[0]!.ingest!.settings));
    share("dataset", shareDataset(group));
    const pipeline = resourceName(group.tables, "pipeline", `pl_${own}`);
    add("pipeline", filesPipeline(model, group, shared, pipeline));
    addTrigger(model, group, pipeline, `tr_${own}`, { add, flows });
  }
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
