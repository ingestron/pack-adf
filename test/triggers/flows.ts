// Flows that write triggers: the design's two examples, and the standard that lets flows write them.
import type { ResolvedModel, ResolvedTrigger } from "@ingestron/definitions";
import { base, generate } from "../erp.js";
import { secondFlow } from "./projects.js";

/** Design example 1: an hourly tumbling window that waits for its own previous window. */
export const hourly = [
  "    - name: hourly",
  "      type: tumbling-window",
  "      every: { frequency: Hour, interval: 1 }",
  '      start: "2026-12-01T00:00:00Z"',
  "      delay: 5m",
  "      concurrency: 1",
  "      retries: { count: 3, interval: 300s }",
  "      depends_on:",
  "        - { self: true, offset: -1h }",
];

/** Design example 2: a weekly full reload on Sundays at 02:00, London time. */
export const reload = [
  "    - name: weekly-reload",
  "      type: schedule",
  "      every: { frequency: Week, interval: 1 }",
  '      start: "2026-07-05T01:00:00Z"',
  "      timezone: Europe/London",
  "      at: { weekdays: [Sunday], hours: [2], minutes: [0] }",
  "      parameters:",
  "        load: full",
];

/** The ERP standard, letting flows write triggers, with more `operations` lines. */
export const perFlow = (operations = "") =>
  `${base["standard.yaml"]!}operations:\n  schedule: { per: flow }\n${operations}`;

interface Options {
  standard?: string;
  environment?: string;
  changes?: Record<string, string>;
  ingest?: string;
}

/** The ERP project with flow `b`, whose ingest writes these trigger lines. */
export function withTriggers(lines: string[], options: Options = {}) {
  const ingest = `${options.ingest ?? ""}  triggers:\n${lines.join("\n")}\n`;
  return generate(
    {
      "standard.yaml": options.standard ?? perFlow(),
      "flow-b.yaml": secondFlow(ingest),
      ...options.changes,
    },
    options.environment,
  );
}

/** The messages of the errors a project gave. */
export const errors = (result: { diagnostics: { severity: string; message: string }[] }) =>
  result.diagnostics.filter((item) => item.severity === "error").map((item) => item.message);

/** A resolved trigger of flow `b` named `x`: an hourly tumbling window in UTC, changed by `over`. */
export const trigger = (over: Partial<ResolvedTrigger> = {}): ResolvedTrigger => ({
  flow: "b",
  name: "x",
  type: "tumbling-window",
  every: { frequency: "Hour", interval: 1 },
  start: "2026-12-01T00:00:00Z",
  timezone: "UTC",
  parameters: {},
  at_source: undefined as never,
  ...over,
});

/** The model of a project that resolved, for the builders. */
export const modelOf = (result: { model?: ResolvedModel }) => result.model!;
