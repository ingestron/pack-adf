// Audit columns: added to the rows by the Copy activity's source, and
// described to the packs that read the landed files.
import { describe, expect, it } from "vitest";
import { base, generate, json } from "./erp.js";
import { tableProject } from "./table-project.js";

const audited = (columns: string[], standard = base["standard.yaml"]!) =>
  standard.replace(
    "      start: 2026-10-01T00:00:00Z\n",
    `      start: 2026-10-01T00:00:00Z\n      audit_columns:\n${columns.map((line) => `        ${line}`).join("\n")}\n`,
  );

describe("audit columns", () => {
  const { result, files } = generate({
    "standard.yaml": audited([
      "_loaded_at: run.trigger_time",
      "_run_id: run.id",
      "_source: source.object",
      "_system: erp",
    ]),
  });

  it("are added by the copy's source", () => {
    expect(result.diagnostics).toEqual([]);
    const source = json(files, "pipeline/pl_erp_erp.json").properties.activities[0].typeProperties
      .source;
    expect(source.additionalColumns).toEqual([
      { name: "_loaded_at", value: { value: "@pipeline().TriggerTime", type: "Expression" } },
      { name: "_run_id", value: { value: "@pipeline().RunId", type: "Expression" } },
      { name: "_source", value: "erp.dbo.Invoices" },
      { name: "_system", value: "erp" },
    ]);
  });

  it("are described in the landed output, in order", () => {
    const table = result.model!.tables.find((item) => item.name === "invoices")!;
    expect((table.ingest!.output as { columns?: unknown }).columns).toEqual([
      {
        name: "_loaded_at",
        logicalType: "timestamp",
        nullable: false,
        description: "Added by ADF: the run's trigger time.",
      },
      {
        name: "_run_id",
        logicalType: "string",
        nullable: false,
        description: "Added by ADF: the pipeline run's ID.",
      },
      {
        name: "_source",
        logicalType: "string",
        nullable: false,
        description: "Added by ADF: the source object the row was copied from.",
      },
      {
        name: "_system",
        logicalType: "string",
        nullable: false,
        description: 'Added by ADF: the text "erp".',
      },
    ]);
  });

  it("are left out when none are set", () => {
    const plain = generate();
    const source = json(plain.files, "pipeline/pl_erp_erp.json").properties.activities[0]
      .typeProperties.source;
    expect(source).not.toHaveProperty("additionalColumns");
    const table = plain.result.model!.tables[0]!;
    expect(table.ingest!.output).not.toHaveProperty("columns");
  });

  it("are added to native table copies", () => {
    const project = tableProject(
      "salesforce",
      "  url: https://synthetic.my.salesforce.com\n  client_id: synthetic-client\n  client_secret: ${secret:salesforce-client}\n  api_version: '60.0'",
      "Account",
    );
    project["standard.yaml"] = audited(["_run_id: run.id"], project["standard.yaml"]);
    const native = generate(project);
    expect(native.result.diagnostics).toEqual([]);
    const pipeline = Object.entries(native.files).find(([path]) => path.startsWith("pipeline/"))!;
    const copy = JSON.parse(pipeline[1]).properties.activities[0];
    expect(copy.typeProperties.source.additionalColumns).toEqual([
      { name: "_run_id", value: { value: "@pipeline().RunId", type: "Expression" } },
    ]);
    expect(copy.typeProperties.translator.mappings.at(-1)).toEqual({
      source: { name: "_run_id" },
      sink: { name: "_run_id" },
    });
  });

  it("are refused for sources read by path", () => {
    const project = tableProject("rest", "  url: https://source.example.test", "orders");
    project["standard.yaml"] = audited(["_run_id: run.id"], project["standard.yaml"]);
    expect(
      generate(project)
        .result.diagnostics.map((item) => item.message)
        .join("\n"),
    ).toContain("audit_columns are not offered for REST yet");
  });
});

describe("the SQL source dataset", () => {
  it("uses ADF's current dataset model, which additional columns need", () => {
    // Checked live: without schema and typeProperties ADF refuses additionalColumns
    // with AdditionalColumnWithInvalidDataset.
    const dataset = json(generate().files, "dataset/ds_erp_erp_erp.json").properties;
    expect(dataset.schema).toEqual([]);
    expect(dataset.typeProperties).toEqual({});
  });
});
