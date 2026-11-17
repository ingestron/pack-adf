// The built-in `load` parameter and a schedule's lookback: an incremental table's query reads
// `load` only when a trigger sets it, and a schedule trigger turns its lookback into the window.
import { describe, expect, it } from "vitest";
import { json, withAfterCopy } from "../erp.js";
import { readFileSync } from "node:fs";
import { query } from "../../src/design/index.js";
import { errors, hourly, perFlow, withTriggers } from "./flows.js";
import { build as generate, projects } from "./projects.js";

const golden = JSON.parse(
  readFileSync(new URL("./golden.json", import.meta.url), "utf8"),
) as Record<string, Record<string, string>>;
const generated = (name: string) => generate(projects[name]!).files;

const incremental = (standard: string) =>
  standard.replace(
    "      start: 2026-10-01T00:00:00Z\n",
    "      mode: incremental\n      watermark_column: modified_at\n      start: 2026-10-01T00:00:00Z\n",
  );

const daily = (...extra: string[]) => [
  "    - name: nightly",
  "      type: schedule",
  "      every: { frequency: Hour, interval: 1 }",
  '      start: "2026-12-01T00:00:00Z"',
  ...extra.map((line) => `      ${line}`),
];

function build(lines: string[], standard = incremental(perFlow())) {
  const { result, files } = withTriggers(lines, { standard });
  expect(errors(result)).toEqual([]);
  return files;
}

const select = "SELECT\n  [invoice_id],\n  [amount],\n  [modified_at]\nFROM [dbo].[Credits]";

describe("a schedule's lookback", () => {
  it("becomes windowStart and windowEnd on the trigger", () => {
    const files = build(daily("lookback: 2h"));
    const pipelines = json(files, "trigger/tr_erp_erp_b_nightly.json").properties.pipelines;
    expect(pipelines[0].parameters).toEqual({
      windowStart:
        "@formatDateTime(addMinutes(trigger().scheduledTime, -120), 'yyyy-MM-ddTHH:mm:ssZ')",
      windowEnd: "@trigger().scheduledTime",
    });
  });

  it("gives a full run the scheduled time for both, before the trigger's other values", () => {
    const files = build(daily("lookback: 2h", "parameters: { load: full }"));
    const parameters = json(files, "trigger/tr_erp_erp_b_nightly.json").properties.pipelines[0]
      .parameters;
    expect(parameters).toEqual({
      windowStart: "@trigger().scheduledTime",
      windowEnd: "@trigger().scheduledTime",
      load: "full",
    });
    expect(Object.keys(parameters)).toEqual(["windowStart", "windowEnd", "load"]);
  });

  it("rounds a lookback that is not whole minutes up, so it still covers it", () => {
    const files = build(daily("lookback: 3630s"));
    const start = json(files, "trigger/tr_erp_erp_b_nightly.json").properties.pipelines[0]
      .parameters.windowStart;
    expect(start).toContain("addMinutes(trigger().scheduledTime, -61)");
  });

  it("leaves a tumbling window's own window alone", () => {
    const files = build(hourly);
    expect(
      json(files, "trigger/tr_erp_erp_b_hourly_h1.json").properties.pipeline.parameters,
    ).toEqual({
      windowStart: "@trigger().outputs.windowStartTime",
      windowEnd: "@trigger().outputs.windowEndTime",
    });
  });

  it("reaches the after-copy parent as the trigger writes it", () => {
    const job =
      "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.App/jobs/sales-job";
    const standard = `${incremental(withAfterCopy(`{ job: "${job}" }`))}operations:\n  schedule: { per: flow }\n`;
    const files = build(daily("lookback: 2h"), standard);
    const sent = json(files, "trigger/tr_erp_erp_b_nightly.json").properties.pipelines[0];
    expect(sent.pipelineReference.referenceName).toBe("pl_erp_erp_b_nightly");
    expect(sent.parameters.windowStart).toContain("addMinutes(trigger().scheduledTime, -120)");
    const parent = json(files, "pipeline/pl_erp_erp_b_nightly.json").properties;
    expect(Object.keys(parent.parameters)).toEqual(["windowStart", "windowEnd"]);
    expect(parent.activities[0].typeProperties.parameters).toEqual({
      windowStart: "@pipeline().parameters.windowStart",
      windowEnd: "@pipeline().parameters.windowEnd",
    });
  });
});

describe("the load switch in an incremental table's query", () => {
  const setLoad = "parameters: { load: incremental }";
  const sqlOf = (files: Record<string, string>) =>
    json(files, "pipeline/pl_erp_erp_b.json").properties.activities[0].typeProperties.source
      .sqlReaderQuery;

  it("writes the select once, and chooses only the WHERE part by the load parameter", () => {
    const query = sqlOf(build(daily("lookback: 2h", setLoad)));
    expect(query).toEqual({
      type: "Expression",
      value:
        `${select}@{if(equals(pipeline().parameters.load,'full'), '', ` +
        "concat('\nWHERE [modified_at] >= ''', " +
        "formatDateTime(pipeline().parameters.windowStart, 'yyyy-MM-dd HH:mm:ss'), " +
        "'''\n  AND [modified_at] < ''', " +
        "formatDateTime(pipeline().parameters.windowEnd, 'yyyy-MM-dd HH:mm:ss'), ''''))}",
    });
  });

  it("declares load as incremental when a table of the pipeline is", () => {
    const files = build(daily("lookback: 2h", setLoad));
    expect(json(files, "pipeline/pl_erp_erp_b.json").properties.parameters.load).toEqual({
      type: "String",
      defaultValue: "incremental",
    });
  });

  it("never reads load in a full table's query", () => {
    const files = build(daily("parameters: { load: full }"), perFlow());
    expect(sqlOf(files)).toBe(select);
    expect(json(files, "pipeline/pl_erp_erp_b.json").properties.parameters.load).toEqual({
      type: "String",
      defaultValue: "full",
    });
  });

  it("keeps the plain window when no trigger sets load", () => {
    const query = sqlOf(build(daily("lookback: 2h")));
    expect(query.value).not.toContain("parameters.load");
    expect(query.value).toContain("WHERE [modified_at] >= '@{formatDateTime(");
  });

  it("doubles single quotes inside the branches, and keeps the select as text", () => {
    const table = {
      contract: { columns: [{ name: "it's" }, { name: "a@{b" }] },
      ingest: {
        object: "erp.dbo.T",
        settings: { mode: "incremental", watermark_column: "it's" },
        triggers: [{ parameters: { load: "full" } }],
      },
    };
    const text = (query(table as never) as { value: string }).value;
    expect(text.startsWith("SELECT\n  [it's],\n  [a@@{b]\nFROM [dbo].[T]@{if(")).toBe(true);
    expect(text).toContain("concat('\nWHERE [it''s] >= ''', ");
  });
});

describe("the ForEach pattern", () => {
  const foreach = incremental(perFlow()).replace("adf-copy:", "adf-copy:\n      pattern: foreach");
  const copy = (lines: string[]) =>
    json(build(lines, foreach), "pipeline/pl_erp_erp_b.json").properties.activities[0]
      .typeProperties.activities[0].typeProperties.source.sqlReaderQuery.value;

  it("leaves the window out of a full run when a trigger sets load", () => {
    expect(copy(daily("lookback: 2h", "parameters: { load: full }"))).toContain(
      "if(or(empty(item().watermark), equals(pipeline().parameters.load,'full')), '', ",
    );
  });

  it("keeps the window test as it was when none does", () => {
    expect(copy(daily("lookback: 2h"))).toContain("if(empty(item().watermark), '', ");
  });
});

describe("room for a filter", () => {
  const table = (mode: string, load: boolean) =>
    ({
      contract: { columns: [{ name: "a" }] },
      ingest: {
        object: "erp.dbo.T",
        settings: { mode, watermark_column: "w" },
        triggers: load ? [{ parameters: { load: "full" } }] : [],
      },
    }) as never;

  it("adds predicates to each branch", () => {
    const text = (query(table("incremental", true), ["[a] > 1"]) as { value: string }).value;
    expect(text).toContain("SELECT\n  [a]\nFROM [dbo].[T]@{if(");
    expect(text).toContain("'full'), '\nWHERE ([a] > 1)', ");
    expect(text).toContain("WHERE (");
    expect(text).toContain("AND ([a] > 1)");
  });

  it("filters a full table without a window", () => {
    expect(query(table("full", false), ["[a] > 1"])).toBe(
      "SELECT\n  [a]\nFROM [dbo].[T]\nWHERE ([a] > 1)",
    );
  });
});

describe("a default group", () => {
  it("keeps its query as the golden file has it", () => {
    for (const name of ["copy", "foreach"]) expect(generated(name)).toEqual(golden[name]);
  });
});
