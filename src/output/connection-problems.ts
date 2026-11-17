// Groups of one connection (and database) share its linked service: the settings that feed it
// must agree across them, whether or not a flow has a pipeline of its own.
import type { ResolvedModel, ResolvedTable } from "@ingestron/definitions";
import { copyGroups, filesGroups } from "./source-groups.js";
import { splitTables } from "./groups.js";
import { tableGroups } from "./table-resources.js";

/** "<table> differs from <first>" for the first table whose values differ, else undefined. */
export function differing(
  tables: ResolvedTable[],
  values: (settings: Record<string, unknown>, table: ResolvedTable) => unknown[],
): string | undefined {
  const key = (table: ResolvedTable) => JSON.stringify(values(table.ingest?.settings ?? {}, table));
  const [first] = tables;
  const different = tables.find((table) => key(table) !== key(first!));
  return first && different && `${different.name} differs from ${first.name}`;
}

const stagingSas = (settings: Record<string, unknown>) =>
  (settings.source_options as Record<string, unknown> | undefined)?.staging_sas;

/** One method's tables, in the groups it builds them in, and what its linked service reads of them. */
interface Method {
  /** The tables of each connection (and database) that has more than one group. */
  split: (model: ResolvedModel) => ResolvedTable[][];
  /** How the problem names the tables. */
  name: (table: ResolvedTable) => string;
  keys: string[];
  values: (settings: Record<string, unknown>) => unknown[];
}

const runtime = (settings: Record<string, unknown>) => [
  settings.integration_runtime,
  settings.runtime_kind,
];

const methods: Method[] = [
  {
    split: (model) =>
      splitTables(copyGroups(model), (group) => `${group.connection.id}.${group.database}`),
    name: ({ ingest }) =>
      `adf-copy tables of ${ingest!.connection.id}.${ingest!.object.split(".")[0]}`,
    keys: ["integration_runtime", "runtime_kind", "encrypt"],
    values: (settings) => [...runtime(settings), settings.encrypt],
  },
  {
    split: (model) => splitTables(filesGroups(model), (group) => group.connection.id),
    name: ({ ingest }) => `adf-files tables of ${ingest!.connection.id}`,
    keys: ["integration_runtime", "runtime_kind"],
    values: runtime,
  },
  {
    split: (model) =>
      splitTables(
        tableGroups(model).map((tables) => ({ tables })),
        ({ tables }) => tables[0]!.ingest!.connection.id,
      ),
    name: ({ ingest }) => `adf-table tables of ${ingest!.connection.id}`,
    keys: ["integration_runtime", "runtime_kind", "staging_sas"],
    values: (settings) => [...runtime(settings), stagingSas(settings)],
  },
];

const list = (keys: string[]) => `${keys.slice(0, -1).join(", ")} and ${keys.at(-1)}`;

/** The problems of tables that share a linked service but not a group, each in the usual words. */
export function connectionProblems(model: ResolvedModel): string[] {
  return methods.flatMap((method) =>
    method.split(model).flatMap((tables) => {
      const different = differing(tables, (settings) => method.values(settings));
      return different
        ? [
            `the ${method.name(tables[0]!)} share one linked service, so ${list(method.keys)} must be the same; ${different}`,
          ]
        : [];
    }),
  );
}
