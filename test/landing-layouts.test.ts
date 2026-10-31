// The copies write each table's files where its layout says.
import { describe, expect, it } from "vitest";
import { base, generate, json } from "./erp.js";
import { tableProject } from "./table-project.js";

const endAtFiles = (standard: string) =>
  standard.replace("packs: [store@1, adf@1]", "packs: [adf@1]\nstore: { default: none }");

function sink(changes: Record<string, string>) {
  const { result, files } = generate(changes);
  expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
  const copy = json(files, "pipeline/pl_erp_erp.json").properties.activities[0];
  return { output: copy.outputs[0], files };
}

describe("adf-copy", () => {
  it("lands one file per table, replaced each run, when the flow ends at the files", () => {
    const { output } = sink({ "standard.yaml": endAtFiles(base["standard.yaml"]!) });
    expect(output.parameters).toEqual({
      folder: "erp/erp.dbo.Invoices",
      file: "erp.dbo.Invoices.parquet",
    });
  });

  it("lands a file per run at the path pattern", () => {
    const standard = endAtFiles(base["standard.yaml"]!).replace(
      "      start: 2026-10-01T00:00:00Z\n",
      '      start: 2026-10-01T00:00:00Z\n      path: "{object}/{yyyy}/{object}_{run}.parquet"\n',
    );
    expect(sink({ "standard.yaml": standard }).output.parameters).toEqual({
      folder: "erp/erp.dbo.Invoices/@{formatDateTime(pipeline().parameters.windowStart, 'yyyy')}",
      file: "erp.dbo.Invoices_@{pipeline().RunId}.parquet",
    });
  });

  it("keeps today's files when a store reads them", () => {
    expect(sink({}).output.parameters).toEqual({
      folder: "erp/erp.dbo.Invoices",
      file: "@{concat(formatDateTime(pipeline().parameters.windowStart, 'yyyyMMddHHmmss'), '_', pipeline().RunId, '.parquet')}",
    });
  });
});

describe("adf-table", () => {
  const office = () => {
    const project = tableProject(
      "microsoft-365",
      "  tenant: tenant\n  application_tenant: tenant\n  client_id: app\n  client_secret: ${secret:app-secret}",
      "BasicDataSet_v0.Message_v1",
    );
    project["standard.yaml"] +=
      "      runtime_kind: azure\n      format: json\n      source_options: { requires_date_filter: true, date_filter_column: CreatedDateTime }\n";
    return project;
  };

  it("lands Microsoft 365 data as one JSON file per table when the flow ends at the files", () => {
    const project = office();
    project["standard.yaml"] = endAtFiles(project["standard.yaml"]!);
    const { output, files } = sink(project);
    expect(output.parameters).toEqual({
      folder: "erp/BasicDataSet_v0.Message_v1",
      file: "BasicDataSet_v0.Message_v1.json",
    });
    const dataset = json(files, "dataset/ds_erp_erp_json.json").properties;
    expect(dataset.parameters).toEqual({ folder: { type: "string" }, file: { type: "string" } });
    expect(dataset.typeProperties.location.fileName).toEqual({
      value: "@dataset().file",
      type: "Expression",
    });
  });

  it("keeps Microsoft 365's folder-only dataset when a store reads the files", () => {
    const { output, files } = sink(office());
    expect(output.parameters).toEqual({ folder: "erp/BasicDataSet_v0.Message_v1" });
    expect(json(files, "dataset/ds_erp_erp_json.json").properties.parameters).toEqual({
      folder: { type: "string" },
    });
  });
});
