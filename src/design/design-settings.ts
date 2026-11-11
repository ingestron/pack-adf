// How a team designs its ADF pipelines from the definitions: one activity per
// table or a ForEach over the table list, the copy's retry policy, audit
// columns added to the landed rows, and where the factory files them.
import type { ResolvedTable } from "@ingestron/definitions";
import { intentAuditColumns } from "./intent-audit.js";

/** A value ADF fills in when it runs, its column type, and what it means. */
export interface AuditValue {
  /** The ADF value: an expression, or a literal for source values; `item` gives the ForEach form. */
  value: (table: ResolvedTable, item: boolean) => string;
  expression: boolean;
  type: "timestamp" | "string";
  description: string;
}

/** The run and source values an audit column can hold; any other text is a literal. */
export const auditValues: Record<string, AuditValue> = {
  "run.trigger_time": {
    value: () => "@pipeline().TriggerTime",
    expression: true,
    type: "timestamp",
    description: "the run's trigger time",
  },
  "run.window_start": {
    value: () => "@pipeline().parameters.windowStart",
    expression: true,
    type: "timestamp",
    description: "the start of the run's window",
  },
  "run.window_end": {
    value: () => "@pipeline().parameters.windowEnd",
    expression: true,
    type: "timestamp",
    description: "the end of the run's window",
  },
  "run.id": {
    value: () => "@pipeline().RunId",
    expression: true,
    type: "string",
    description: "the pipeline run's ID",
  },
  "run.pipeline": {
    value: () => "@pipeline().Pipeline",
    expression: true,
    type: "string",
    description: "the pipeline's name",
  },
  "source.object": {
    value: (table, item) => (item ? "@item().object" : table.ingest!.object),
    expression: false,
    type: "string",
    description: "the source object the row was copied from",
  },
  "source.connection": {
    value: (table, item) => (item ? "@item().connection" : table.ingest!.connection.id),
    expression: false,
    type: "string",
    description: "the connection the row was copied from",
  },
};

const known = Object.keys(auditValues).join(", ");

/** What `parallel` copies at once when it is not set. */
export const defaultParallel = 4;

/** The allowed whole numbers of the numeric design settings, for the schema and its descriptions. */
export const designRanges = {
  parallel: { minimum: 1, maximum: 50 },
  retries: { minimum: 0, maximum: 10 },
  retry_interval: { minimum: 30, maximum: 86400 },
  timeout: { minimum: 10, maximum: 10080 },
};

/** "from 1 to 50", the range a description states. */
const between = ({ minimum, maximum }: { minimum: number; maximum: number }) =>
  `from ${minimum} to ${maximum}`;

/** The audit values and what each means, for the values list of an audit column. */
const auditNames = Object.keys(auditValues);
const auditMeanings = Object.values(auditValues).map((value) =>
  `${value.description} (${value.type}).`.replace(/^./, (letter) => letter.toUpperCase()),
);

/** The run or source value a written audit value names, in any case; undefined for literal text. */
export function auditValueOf(written: string): AuditValue | undefined {
  const key = written.toLowerCase();
  return Object.hasOwn(auditValues, key) ? auditValues[key] : undefined;
}

/** The design settings every ADF copy method accepts (audit columns: tabular methods only). */
export const designSettings = {
  pattern: {
    enum: ["activities", "foreach"],
    enumDescriptions: [
      "One Copy activity per table. The default.",
      "One parameterised Copy inside a ForEach over the pipeline's tables parameter, whose default is the generated table list. Pass a shorter list to rerun some tables.",
    ],
    description:
      "How each pipeline copies its tables. `foreach` is offered for `adf-copy`. The `adf-copy` tables of one connection and database must use the same `pattern`; with `foreach` they must also use the same `parallel`, `activity` and `audit_columns`.",
  },
  parallel: {
    type: "integer",
    ...designRanges.parallel,
    default: defaultParallel,
    description: `With \`pattern: foreach\`, how many tables are copied at once (the ForEach's batch count), ${between(designRanges.parallel)}.`,
    examples: [defaultParallel],
  },
  activity: {
    type: "object",
    additionalProperties: false,
    description: "The Copy activity's policy. Keys left out use ADF's defaults.",
    properties: {
      retries: {
        type: "integer",
        ...designRanges.retries,
        description: `How often a failed copy is tried again within the run, ${between(designRanges.retries)}. The window's \`retries\` still retries the whole window.`,
        examples: [2],
      },
      retry_interval: {
        type: "integer",
        ...designRanges.retry_interval,
        description: `Seconds between tries, ${between(designRanges.retry_interval)}.`,
        examples: [60],
      },
      timeout: {
        type: "integer",
        ...designRanges.timeout,
        description: `Minutes a copy may run before ADF stops it, ${between(designRanges.timeout)}. ADF's own minimum is ${designRanges.timeout.minimum}; a smaller value is refused.`,
        examples: [120],
      },
    },
  },
  audit_columns: {
    type: "object",
    description:
      "Columns added to every landed row, by name, for `adf-copy` and `adf-table`. ADF fills in the run values when it runs.",
    additionalProperties: {
      anyOf: [
        {
          enum: auditNames,
          enumDescriptions: auditMeanings,
        },
        { type: "string", minLength: 1 },
      ],
      description:
        "What the column holds: one of these run or source values, in any case, or literal text, such as `${environment.name}`, which is written as it is.",
    },
    examples: [{ _loaded_at: "run.trigger_time", _run_id: "run.id", _source: "source.object" }],
  },
  folder: {
    type: "string",
    minLength: 1,
    pattern: "^[^/].*[^/]$|^[^/]$",
    description:
      "The factory folder for the project's pipelines and datasets, such as ingestron/erp.",
    examples: ["ingestron/${project.id}"],
  },
  annotations: {
    type: "array",
    items: { type: "string", minLength: 1 },
    description: "Annotations added to the project's pipelines, after Ingestron's own.",
    examples: [["erp", "finance"]],
  },
};

/** The design settings belong in the standard: they are the team's design. */
export const designPlacement = Object.keys(designSettings);

/** The design settings without audit columns, for files copied as they are. */
export const fileDesignSettings = Object.fromEntries(
  Object.entries(designSettings).filter(([key]) => key !== "audit_columns"),
);

/** Problems with a table's design settings, as METHOD_CHECK messages. */
export function designProblems(table: ResolvedTable): string[] {
  const settings = table.ingest!.settings;
  const problems: string[] = [];
  if (settings.pattern === "foreach" && table.ingest!.method !== "adf-copy")
    problems.push(`pattern: foreach is offered for adf-copy, not ${table.ingest!.method}`);
  if (settings.parallel !== undefined && settings.pattern !== "foreach")
    problems.push("parallel applies to pattern: foreach");
  const columns = (settings.audit_columns ?? {}) as Record<string, string>;
  const contract = new Set(table.contract.columns.map((column) => column.name.toLowerCase()));
  for (const [name, value] of Object.entries(columns))
    problems.push(...auditProblems(name, value, contract));
  const fromIntent = intentAuditColumns(table);
  for (const [name, value] of fromIntent) {
    if (Object.hasOwn(columns, name))
      problems.push(
        `the audit column "${name}" is named twice: in audit_columns and in the layer's audit`,
      );
    else problems.push(...auditProblems(name, value, contract));
  }
  problems.push(
    ...caseProblems([...new Set([...Object.keys(columns), ...fromIntent.map(([name]) => name)])]),
  );
  return problems;
}

/** Columns the packs that read the files add themselves (DuckDB's file name, Databricks' rescued data). */
const reserved = ["_ingestron_file", "_rescued_data"];

/** Audit columns whose names differ only by case: the engines compare names case-insensitively. */
function caseProblems(names: string[]): string[] {
  const seen = new Map<string, string>();
  const problems: string[] = [];
  for (const name of names) {
    const earlier = seen.get(name.toLowerCase());
    if (earlier)
      problems.push(`audit columns "${earlier}" and "${name}" differ only by case; rename one`);
    else seen.set(name.toLowerCase(), name);
  }
  return problems;
}

/** Problems with one audit column: its name, a clash with the contract, its value. */
function auditProblems(name: string, value: string, contract: Set<string>): string[] {
  const problems: string[] = [];
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    problems.push(
      `audit column "${name}" must start with a letter or underscore and hold only letters, digits and underscores`,
    );
  if (reserved.includes(name.toLowerCase()))
    problems.push(`audit column "${name}" is a name the packs that read the files use; rename it`);
  if (contract.has(name.toLowerCase()))
    problems.push(`audit column "${name}" is in the contract or the source metadata; rename it`);
  if (/^(run|source)\./i.test(value) && !auditValueOf(value))
    problems.push(`audit column "${name}" uses "${value}"; run and source values: ${known}`);
  else if (value.startsWith("@") || value.includes("@{"))
    problems.push(`audit column "${name}" holds "${value}", which ADF reads as an expression`);
  return problems;
}
