// What the pack does with each intent path and value (definitions specification, section 11).
// Every other path and value is planned: the mapping in spec/behaviour.md is the target.
import {
  intentPaths,
  type FeatureStatus,
  type IntentUse,
  type SettingAlias,
} from "@ingestron/definitions";

/** The pages that give each feature's release status; all were read on 2026-11-09. */
const pages = {
  copy: "https://learn.microsoft.com/en-us/azure/data-factory/copy-activity-overview",
  columns:
    "https://learn.microsoft.com/en-us/azure/data-factory/copy-activity-overview#add-additional-columns-during-copy",
  incremental:
    "https://learn.microsoft.com/en-us/azure/data-factory/tutorial-incremental-copy-overview",
  variables: "https://learn.microsoft.com/en-us/azure/data-factory/control-flow-system-variables",
  tumbling:
    "https://learn.microsoft.com/en-us/azure/data-factory/how-to-create-tumbling-window-trigger",
  policy:
    "https://learn.microsoft.com/en-us/azure/data-factory/concepts-pipelines-activities#activity-policy",
};

const ga = (source: string): FeatureStatus => ({ level: "ga", checked: "2026-11-09", source });
const used = (does: string, source: string): IntentUse => ({
  use: "used",
  does,
  status: ga(source),
});
const notYet: IntentUse = { use: "not-yet", reason: "Planned." };

/**
 * What ADF cannot keep. The store step keeps the table, and on a table that ends at the
 * landed files this pack judges every path, so the reason holds in both cases.
 */
const landsOnly: IntentUse = {
  use: "not-applicable",
  reason: "ADF only lands files; nothing keeps the table.",
};

const storeKeeps: IntentUse = { use: "elsewhere", reason: "The store step keeps the table." };

/** The paths the step that stores the table judges. */
const storeOwned = (path: string) =>
  [
    "history",
    "sequence",
    "rescued",
    "quality.results",
    "retention.time_travel",
    "retention.log",
  ].includes(path) || path.startsWith("storage.");

/** Every path and value as planned, so each takes the entry below it, if any. */
function planned(): Record<string, IntentUse> {
  return Object.fromEntries(
    Object.keys(intentPaths).map((path) => [path, storeOwned(path) ? landsOnly : notYet]),
  );
}

/** The pack's coverage: what it builds, what a store keeps, and the rest planned. */
export const intent: Record<string, IntentUse> = {
  ...planned(),
  "load.mode=full": used("A copy of the whole selection each window.", pages.copy),
  "load.mode=files": used("A binary copy of the files changed in the window.", pages.incremental),
  "load.mode=incremental": used(
    "A copy of the rows past the watermark column in the window (SQL Server family only).",
    pages.incremental,
  ),
  "load.cursor": used("The watermark column of an incremental copy.", pages.incremental),
  // The load mode judges deletes at the source; the store step applies them to the table.
  "load.deletes.mode": storeKeeps,
  "load.deletes.when": storeKeeps,
  "audit=run_id": used("An additional column of @pipeline().RunId.", pages.variables),
  "audit=window_start": used(
    "An additional column of the tumbling window's start.",
    pages.tumbling,
  ),
  "audit=window_end": used("An additional column of the tumbling window's end.", pages.tumbling),
  "audit=source_object": used("An additional column of the source object's name.", pages.columns),
  "audit=source_connection": used("An additional column of the connection's id.", pages.columns),
  // ADF adds it only when the table ends at the landed files; otherwise the store step does.
  "audit=loaded_at": used(
    "An additional column of @pipeline().TriggerTime, on a table that ends at the landed files.",
    pages.variables,
  ),
  "operations.retries": used(
    "The tumbling window trigger's retry count; the wait stays five minutes.",
    pages.tumbling,
  ),
  "operations.timeout": used("The Copy activity's timeout.", pages.policy),
};

/** What differs for `adf-copy`, which reads a table, not files. */
export const copyIntent: Record<string, IntentUse> = {
  "load.mode=files": { use: "not-applicable", reason: "adf-copy reads a table, not files." },
};

/** What differs for `adf-table`, which copies the whole selection each window. */
export const tableIntent: Record<string, IntentUse> = {
  ...copyIntent,
  "load.mode=incremental": {
    use: "not-applicable",
    reason:
      "adf-table copies the whole selection each window; use adf-copy for an incremental load.",
  },
  "load.cursor": {
    use: "not-applicable",
    reason: "adf-table copies the whole selection each window.",
  },
};

/** What differs for `adf-files`, which copies files as they are, so adds no columns. */
export const filesIntent: Record<string, IntentUse> = {
  "load.mode=full": { use: "not-applicable", reason: "adf-files copies files, not a table." },
  "load.mode=incremental": {
    use: "not-applicable",
    reason: "adf-files copies files, not a table.",
  },
  "load.cursor": { use: "not-applicable", reason: "adf-files copies files, not a table." },
  ...Object.fromEntries(
    ["run_id", "window_start", "window_end", "source_object", "source_connection", "loaded_at"].map(
      (value) => [
        `audit=${value}`,
        {
          use: "not-applicable",
          reason: "adf-files copies files as they are, so it adds no columns.",
        } satisfies IntentUse,
      ],
    ),
  ),
};

/** `adf-copy`'s `mode` and `watermark_column` are other names for the load mode and cursor. */
export const copyAliases: Record<string, SettingAlias> = {
  mode: {
    values: {
      full: { load: { mode: "full" } },
      incremental: { load: { mode: "incremental" } },
    },
  },
  watermark_column: { path: "load.cursor" },
};
