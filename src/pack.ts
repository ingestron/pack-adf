// The pack: three methods, rules for private sources, and the build function.
import { adfTable } from "./table-method.js";
import { tableGroups } from "./table-resources.js";
import { contract } from "./contract.js";
import type { Pack, ResolvedModel, ResolvedTable } from "@ingestron/definitions";
import { parseLanding } from "./landing.js";
import { samePathProblems } from "./landing-output.js";
import { connectors } from "./connectors.js";
import { build, copyGroups, filesGroups } from "./build.js";
import { adfFiles } from "./files-method.js";
import { adfCopy } from "./method.js";
import { request } from "./request.js";
import { checkingAfterCopy } from "./after-copy-settings.js";

/**
 * The Azure Data Factory pack, version 1. Use it with a platform pack:
 * `packs: [databricks@1, adf@1]`.
 * @example
 * const result = loadDefinitions("definitions", { packs: [databricks, adf], environment: "dev" });
 * if (result.model) console.log(Object.keys(adf.build(result.model)));
 */
export const adf: Pack = {
  id: "adf",
  version: 1,
  // Used only when this pack is listed first, which a standard should not do:
  // ADF only copies, so another pack must store the data.
  defaults: {
    naming: {
      catalog: "{{ environment }}",
      schema: "{{ layer }}",
      table: "{{ table }}",
      pipeline: "{{ project }}",
      job: "{{ project }}_refresh",
    },
    layers: ["bronze", "silver", "gold"],
    types: {},
    quality: { required: "warn", default: "warn" },
  },
  // A rule only counts when its method can read the source, so each connector finds its own.
  rules: {
    ingest: {
      when: [
        { connectivity: "private", use: "adf-copy" },
        { connectivity: "private", use: "adf-files" },
        { connectivity: "private", use: "adf-table" },
      ],
    },
  },
  methods: {
    "adf-copy": checkingAfterCopy(adfCopy),
    "adf-files": checkingAfterCopy(adfFiles),
    "adf-table": checkingAfterCopy(adfTable),
  },
  connectors,
  contract,
  check: checkShared,
  build,
  request,
};

/**
 * Settings that become shared resources must agree: one Key Vault and one
 * landing storage per project, and one runtime and schedule per source database.
 */
function checkShared(model: ResolvedModel): string[] {
  const tables = model.tables.filter((table) =>
    /^adf-(copy|files|table)$/.test(table.ingest?.method ?? ""),
  );
  const project = differing(tables, (settings) => {
    const { url, fileSystem } = parseLanding(String(settings.landing));
    return [settings.key_vault, url, fileSystem];
  });
  const problems = project
    ? [`every ADF table must use the same key_vault and landing storage; ${project}`]
    : [];
  const job = differing(tables, (settings) => [settings.after_copy]);
  if (job) problems.push(`every ADF table must use the same after_copy; ${job}`);
  try {
    build(model);
  } catch (error) {
    return [...problems, (error as Error).message];
  }
  for (const group of copyGroups(model)) {
    const different = differing(group.tables, (settings) => groupKeys.map((key) => settings[key]));
    if (different)
      problems.push(
        `the adf-copy tables of ${group.connection.id}.${group.database} share one linked service, pipeline and trigger, so ${groupKeys.slice(0, -1).join(", ")} and ${groupKeys.at(-1)} must be the same; ${different}`,
      );
  }
  for (const group of filesGroups(model)) {
    const different = differing(group.tables, (settings) => shareKeys.map((key) => settings[key]));
    if (different)
      problems.push(
        `the adf-files tables of ${group.connection.id} share one linked service, pipeline and trigger, so ${shareKeys.slice(0, -1).join(", ")} and ${shareKeys.at(-1)} must be the same; ${different}`,
      );
  }
  problems.push(...nativeGroupProblems(model));
  problems.push(...landingConflicts(tables.filter((table) => !table.ingest?.settings.path)));
  problems.push(
    ...samePathProblems(tables.filter((table) => table.ingest?.method !== "adf-files")),
  );
  return problems;
}

const shareKeys = ["integration_runtime", "runtime_kind", "every", "start", "retries", "paused"];

const groupKeys = [
  "integration_runtime",
  "runtime_kind",
  "encrypt",
  "every",
  "start",
  "retries",
  "paused",
];

/** "<table> differs from <first>" for the first table whose values differ, else undefined. */
function differing(
  tables: ResolvedTable[],
  values: (settings: Record<string, unknown>) => unknown[],
): string | undefined {
  const key = (table: ResolvedTable) => JSON.stringify(values(table.ingest?.settings ?? {}));
  const [first] = tables;
  const different = tables.find((table) => key(table) !== key(first!));
  return first && different && `${different.name} differs from ${first.name}`;
}

function landingConflicts(tables: ResolvedTable[]): string[] {
  const seen = new Map<string, string>();
  const problems: string[] = [];
  for (const table of tables) {
    const ingest = table.ingest!;
    const path = `${String(ingest.settings.landing).replace(/\/$/, "")}/${ingest.object.replace(/\/$/, "")}/`;
    for (const [previous, name] of seen)
      if (path.startsWith(previous) || previous.startsWith(path))
        problems.push(
          `ADF landing paths overlap for ${name} and ${table.name}; use distinct landing folders`,
        );
    seen.set(path, table.name);
  }
  return problems;
}

function nativeGroupProblems(model: ResolvedModel): string[] {
  const problems: string[] = [];
  for (const group of tableGroups(model)) {
    const different = differing(group, (settings) => [
      ...shareKeys.map((key) => settings[key]),
      (settings.source_options as Record<string, unknown> | undefined)?.staging_sas,
    ]);
    if (different)
      problems.push(
        `the adf-table tables of ${group[0]!.ingest!.connection.id} share one runtime and schedule; ${different}`,
      );
  }
  return problems;
}
