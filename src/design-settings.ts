// How a team designs its ADF pipelines from the definitions: one activity per
// table or a ForEach over the table list, the copy's retry policy, audit
// columns added to the landed rows, and where the factory files them.
import type { ResolvedTable } from "@ingestron/definitions";

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

/** The design settings every ADF copy method accepts (audit columns: tabular methods only). */
export const designSettings = {
  pattern: {
    enum: ["activities", "foreach"],
    enumDescriptions: [
      "One Copy activity per table. The default.",
      "One parameterised Copy inside a ForEach over the pipeline's tables parameter, whose default is the generated table list. Pass a shorter list to rerun some tables.",
    ],
    description: "How each pipeline copies its tables. foreach is offered for adf-copy.",
  },
  parallel: {
    type: "integer",
    minimum: 1,
    maximum: 50,
    description:
      "pattern: foreach: how many tables are copied at once (the ForEach batch count). Default 4.",
    examples: [4],
  },
  activity: {
    type: "object",
    additionalProperties: false,
    description: "The Copy activity's policy. Keys left out use ADF's defaults.",
    properties: {
      retries: {
        type: "integer",
        minimum: 0,
        maximum: 10,
        description: "How often a failed copy is tried again within the run.",
        examples: [2],
      },
      retry_interval: {
        type: "integer",
        minimum: 30,
        maximum: 86400,
        description: "Seconds between tries.",
        examples: [60],
      },
      timeout: {
        type: "integer",
        minimum: 1,
        maximum: 10080,
        description: "Minutes a copy may run before ADF stops it.",
        examples: [120],
      },
    },
  },
  audit_columns: {
    type: "object",
    description: `Columns added to every landed row, by name. A value is one of ${known}, filled in by ADF when it runs, or literal text such as \${environment.name}.`,
    additionalProperties: { type: "string", minLength: 1 },
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
  problems.push(...caseProblems(Object.keys(columns)));
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
    problems.push(`audit column "${name}" is a contract column; give it another name`);
  if (/^(run|source)\./.test(value) && !(value in auditValues))
    problems.push(`audit column "${name}" uses "${value}"; run and source values: ${known}`);
  else if (value.startsWith("@") || value.includes("@{"))
    problems.push(`audit column "${name}" holds "${value}", which ADF reads as an expression`);
  return problems;
}
