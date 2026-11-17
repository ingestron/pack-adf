// The tables each pipeline of adf-copy and adf-files copies, and the names their resources
// are made from.
import type { ResolvedModel, ResolvedTable } from "@ingestron/definitions";
import { resourceName } from "../factory/index.js";
import type { CopyGroup, FilesGroup } from "../resources/index.js";
import { groupKey } from "./groups.js";

/** `<project>_<connection>`, then `_<database>` when the database is not named like the connection. */
export function copyName(project: string, group: CopyGroup): string {
  const database = group.database === group.connection.id ? "" : `_${group.database}`;
  return `${project}_${group.connection.id}${database}`;
}

/** Tables copied with adf-files, grouped by connection: one share, one pipeline. */
export function filesGroups(model: ResolvedModel): FilesGroup[] {
  const groups = new Map<string, FilesGroup>();
  for (const table of model.tables.filter(
    (candidate) => candidate.ingest?.method === "adf-files",
  )) {
    const connection = table.ingest!.connection;
    const key = groupKey(table);
    const names = `${model.project.id}_${connection.id}`;
    const group = groups.get(key) ?? {
      connection,
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

/** Tables copied with adf-copy, grouped by connection and source database. */
export function copyGroups(model: ResolvedModel): CopyGroup[] {
  const groups = new Map<string, CopyGroup>();
  for (const table of model.tables.filter((candidate) => candidate.ingest?.method === "adf-copy")) {
    const connection = table.ingest!.connection;
    const database = table.ingest!.object.split(".")[0] ?? "";
    const key = `${groupKey(table)}.${database}`;
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
