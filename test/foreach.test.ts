// pattern: foreach: one parameterised Copy inside a ForEach over the
// pipeline's tables parameter, whose default is the generated table list.
import { describe, expect, it } from "vitest";
import { base, generate, json, landing, withAfterCopy } from "./erp.js";

const standard = (lines: string[]) =>
  base["standard.yaml"]!.replace(
    "      start: 2026-10-01T00:00:00Z\n",
    `      start: 2026-10-01T00:00:00Z\n${lines.map((line) => `      ${line}`).join("\n")}\n`,
  );

const twoTables = (credits = "") =>
  "apiVersion: ingestron.io/v1\nkind: Flow\nid: erp\nsource: erp\ntables:\n" +
  "  invoices: { object: erp.dbo.Invoices, contract: invoices }\n" +
  `  credits: { object: erp.dbo.Credits, contract: invoices${credits} }\n`;

const pipeline = (lines: string[], flow = twoTables()) => {
  const { result, files } = generate({
    "standard.yaml": standard(["pattern: foreach", ...lines]),
    "flow.yaml": flow,
  });
  expect(result.diagnostics).toEqual([]);
  return { files, properties: json(files, "pipeline/pl_erp_erp.json").properties };
};

describe("pattern: foreach", () => {
  it("builds one ForEach over the table list", () => {
    const { properties } = pipeline([
      "layout: snapshot",
      "activity: { retries: 2 }",
      "audit_columns: { _run_id: run.id, _source: source.object }",
    ]);
    expect(properties.parameters.tables.type).toBe("array");
    expect(properties.parameters.tables.defaultValue).toEqual([
      {
        table: "invoices",
        object: "erp.dbo.Invoices",
        connection: "erp",
        query: "SELECT [invoice_id], [amount], [modified_at] FROM [dbo].[Invoices]",
        watermark: "",
        folder: "erp/erp.dbo.Invoices",
        file: "erp.dbo.Invoices.parquet",
      },
      {
        table: "credits",
        object: "erp.dbo.Credits",
        connection: "erp",
        query: "SELECT [invoice_id], [amount], [modified_at] FROM [dbo].[Credits]",
        watermark: "",
        folder: "erp/erp.dbo.Credits",
        file: "erp.dbo.Credits.parquet",
      },
    ]);
    expect(properties.activities).toHaveLength(1);
    const loop = properties.activities[0];
    expect(loop.name).toBe("for_each_table");
    expect(loop.type).toBe("ForEach");
    expect(loop.typeProperties.items).toEqual({
      value: "@pipeline().parameters.tables",
      type: "Expression",
    });
    expect(loop.typeProperties.isSequential).toBe(false);
    expect(loop.typeProperties.batchCount).toBe(4);
    const [copy] = loop.typeProperties.activities;
    expect(copy.name).toBe("copy_table");
    expect(copy.policy).toEqual({ retry: 2 });
    expect(copy.outputs[0].parameters.folder).toEqual({
      value: "@item().folder",
      type: "Expression",
    });
    expect(copy.typeProperties.source.additionalColumns).toEqual([
      { name: "_run_id", value: { value: "@pipeline().RunId", type: "Expression" } },
      { name: "_source", value: { value: "@item().object", type: "Expression" } },
    ]);
  });

  it("incremental items carry the watermark, not an expression", () => {
    const { properties } = pipeline([
      "mode: incremental",
      "watermark_column: modified_at",
      "layout: increments",
    ]);
    const items = properties.parameters.tables.defaultValue;
    expect(items[0].watermark).toBe("[modified_at]");
    expect(JSON.stringify(items)).not.toContain("@");
    const query = properties.activities[0].typeProperties.activities[0].typeProperties.source
      .sqlReaderQuery;
    expect(query.type).toBe("Expression");
    expect(query.value).toContain("item().watermark");
    expect(query.value).toContain(
      "formatDateTime(pipeline().parameters.windowStart, 'yyyy-MM-dd HH:mm:ss')",
    );
  });

  it("increments name each run's file", () => {
    const { properties } = pipeline(["layout: increments"]);
    expect(properties.parameters.tables.defaultValue[0].file).toBe("");
    const file = properties.activities[0].typeProperties.activities[0].outputs[0].parameters.file;
    expect(file.value).toContain("pipeline().RunId");
    expect(file.value).toContain("item().file");
  });

  it("copies parallel tables at once", () => {
    expect(pipeline(["parallel: 8"]).properties.activities[0].typeProperties.batchCount).toBe(8);
  });

  it("keeps the trigger and resource names", () => {
    const { files } = pipeline([]);
    const plain = generate({ "flow.yaml": twoTables() }).files;
    expect(files["trigger/tr_erp_erp.json"]).toBe(plain["trigger/tr_erp_erp.json"]);
    expect(Object.keys(files).sort()).toEqual(Object.keys(plain).sort());
  });

  it("tables of one pipeline must agree", () => {
    const { result } = generate({
      "standard.yaml": standard(["pattern: foreach"]),
      "flow.yaml": twoTables(", ingest: { with: { activity: { retries: 1 } } }"),
    });
    const found = result.diagnostics.map((item) => item.message).join("\n");
    expect(found).toContain("credits differs from invoices");
    expect(found).toContain("activity");
  });

  it("refuses a dated path", () => {
    const { result } = generate({
      "standard.yaml": standard([
        "pattern: foreach",
        'path: "{object}/{yyyy}/{MM}/{dd}/{object}_{run}.parquet"',
      ]),
    });
    expect(result.diagnostics.map((item) => item.message).join("\n")).toContain(
      "use pattern: activities for a path with date or run tokens",
    );
  });

  it("lands where the activities pattern lands", () => {
    const { properties } = pipeline(["layout: snapshot"]);
    expect(properties.parameters.tables.defaultValue[0].folder).toBe(
      `${landing.split("/").at(-1)}/erp.dbo.Invoices`,
    );
  });
});

describe("pattern: foreach with after_copy", () => {
  const job =
    "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.App/jobs/sales-job";
  const copyOf = (lines: string[]) => {
    const { result, files } = generate({
      "standard.yaml": withAfterCopy(`{ job: "${job}" }`).replace(
        "      start: 2026-10-01T00:00:00Z\n",
        `      start: 2026-10-01T00:00:00Z\n${lines.map((line) => `      ${line}`).join("\n")}\n`,
      ),
    });
    expect(result.diagnostics).toEqual([]);
    const child = json(files, "pipeline/pl_erp_erp.json").properties.activities[0];
    return child.type === "ForEach" ? child.typeProperties.activities[0] : child;
  };

  it("retries the copy inside the ForEach as the window would have been", () => {
    expect(copyOf(["pattern: foreach"]).policy).toMatchObject({
      retry: 2,
      retryIntervalInSeconds: 300,
    });
  });

  it("keeps the team's own activity retries", () => {
    expect(copyOf(["pattern: foreach", "activity: { retries: 5 }"]).policy.retry).toBe(5);
    expect(copyOf(["activity: { retries: 5, retry_interval: 30 }"]).policy).toMatchObject({
      retry: 5,
      retryIntervalInSeconds: 30,
    });
  });
});
