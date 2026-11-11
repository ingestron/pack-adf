// Audit columns from the layer's audit intent (spec/behaviour.md, section "Intent").
import { describe, expect, it } from "vitest";
import { tableProject } from "./table-project.js";
import { generate, pipeline, salesforce, standardWith, withLines } from "./intent-helpers.js";

describe("audit columns from the layer", () => {
  const layers = (audit: string) =>
    standardWith(["layers:", `  - { name: bronze, audit: ${audit} }`, "  - silver", "  - gold"]);

  it("adds a column for each run and source value", () => {
    const { result, files } = generate({
      "standard.yaml": layers(
        "[run_id, window_start, window_end, source_object, source_connection]",
      ),
    });
    expect(result.diagnostics).toEqual([]);
    const source = pipeline(files).properties.activities[0].typeProperties.source;
    expect(source.additionalColumns).toEqual([
      { name: "_run_id", value: { value: "@pipeline().RunId", type: "Expression" } },
      {
        name: "_window_start",
        value: { value: "@pipeline().parameters.windowStart", type: "Expression" },
      },
      {
        name: "_window_end",
        value: { value: "@pipeline().parameters.windowEnd", type: "Expression" },
      },
      { name: "_source_object", value: "erp.dbo.Invoices" },
      { name: "_source_connection", value: "erp" },
    ]);
  });

  it("names the column as the layer says", () => {
    const { result, files } = generate({
      "standard.yaml": layers("[{ value: run_id, as: batch_id }]"),
    });
    expect(result.diagnostics).toEqual([]);
    const source = pipeline(files).properties.activities[0].typeProperties.source;
    expect(source.additionalColumns).toEqual([
      { name: "batch_id", value: { value: "@pipeline().RunId", type: "Expression" } },
    ]);
  });

  it("adds the columns after audit_columns, and describes them in the landed output", () => {
    const { result, files } = generate({
      "standard.yaml": withLines(["audit_columns:", "  _system: erp"], layers("[run_id]")),
    });
    expect(result.diagnostics).toEqual([]);
    const source = pipeline(files).properties.activities[0].typeProperties.source;
    expect(source.additionalColumns.map((column: { name: string }) => column.name)).toEqual([
      "_system",
      "_run_id",
    ]);
    const output = result.model!.tables[0]!.ingest!.output as { columns?: { name: string }[] };
    expect(output.columns?.map((column) => column.name)).toEqual(["_system", "_run_id"]);
  });

  it("refuses a column named in both", () => {
    const { result } = generate({
      "standard.yaml": withLines(["audit_columns:", "  _run_id: run.id"], layers("[run_id]")),
    });
    expect(result.diagnostics.map((item) => item.message)).toContainEqual(
      expect.stringContaining(
        'the audit column "_run_id" is named twice: in audit_columns and in the layer\'s audit',
      ),
    );
  });

  it("adds loaded_at as the trigger time only when the table ends at the landed files", () => {
    const stored = generate({ "standard.yaml": layers("[loaded_at]") });
    expect(stored.result.diagnostics).toEqual([]);
    expect(
      pipeline(stored.files).properties.activities[0].typeProperties.source,
    ).not.toHaveProperty("additionalColumns");

    const landed = generate({
      "standard.yaml": `${layers("[loaded_at]")}store: { default: none }\n`,
    });
    expect(landed.result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(
      pipeline(landed.files).properties.activities[0].typeProperties.source.additionalColumns,
    ).toEqual([
      { name: "_loaded_at", value: { value: "@pipeline().TriggerTime", type: "Expression" } },
    ]);
  });
});

describe("audit columns from the layer for native sources", () => {
  const layered = (project: Record<string, string>) => ({
    ...project,
    "standard.yaml": `${project["standard.yaml"]}layers:\n  - { name: bronze, audit: [run_id] }\n  - silver\n  - gold\n`,
  });

  it("are added to native table copies, and mapped", () => {
    const { result, files } = generate(layered(salesforce()));
    expect(result.diagnostics).toEqual([]);
    const [, text] = Object.entries(files).find(([path]) => path.startsWith("pipeline/"))!;
    const copy = JSON.parse(text).properties.activities[0];
    expect(copy.typeProperties.source.additionalColumns).toEqual([
      { name: "_run_id", value: { value: "@pipeline().RunId", type: "Expression" } },
    ]);
    expect(copy.typeProperties.translator.mappings.at(-1)).toEqual({
      source: { name: "_run_id" },
      sink: { name: "_run_id" },
    });
  });

  it("are refused for sources read by path", () => {
    const project = layered(tableProject("rest", "  url: https://source.example.test", "orders"));
    expect(
      generate(project)
        .result.diagnostics.map((item) => item.message)
        .join("\n"),
    ).toContain("the layer's audit is not offered for REST yet");
  });
});
