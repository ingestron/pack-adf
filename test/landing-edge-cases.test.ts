// Layouts that would lose data, collide, or produce invalid ADF output.
import type { ResolvedModel } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { pathProblems } from "../src/layout.js";
import { base, generate, json, landing } from "./erp.js";
import { tableProject } from "./table-project.js";

const endAtFiles = (standard: string) =>
  standard.replace("packs: [store@1, adf@1]", "packs: [adf@1]\nstore: { default: none }");
const withSettings = (standard: string, settings: string) =>
  standard.replace(
    "      start: 2026-10-01T00:00:00Z\n",
    `      start: 2026-10-01T00:00:00Z\n${settings}`,
  );
const twoTables = (flow: string, second: string) =>
  flow.replace(/( {2}invoices: \{[^\n]*\}\n)/, `$1${second}`);
const withCopies = (contract: string) =>
  contract.replace(
    "schema:\n",
    "schema:\n  - name: copies\n    logicalType: object\n    properties:\n      - { name: invoice_id, logicalType: integer }\n",
  );
const problems = (changes: Record<string, string>) =>
  generate(changes).result.diagnostics.map(({ code, message }) => ({ code, message }));
const lost =
  "each run holds only the window's changes and replaces the last file, so changes would be lost; keep a file per run (layout: increments, or a path with {run}), or add a store step";

describe("tables landing at the same file", () => {
  it("needs {object} in a path pattern, so tables keep their own files", () => {
    expect(pathProblems("{yyyy}/{MM}/{run}.parquet", "parquet")).toEqual([
      'the path pattern "{yyyy}/{MM}/{run}.parquet" must include {object}',
    ]);
  });

  it("refuses two tables whose path patterns land at the same files", () => {
    const standard = withSettings(
      endAtFiles(base["standard.yaml"]!),
      '      path: "{object}/{run}.parquet"\n',
    );
    expect(
      problems({
        "standard.yaml": standard,
        "flow.yaml": twoTables(
          base["flow.yaml"]!,
          "  copies: { object: erp.dbo.Invoices, contract: invoices }\n",
        ),
        "invoices.yaml": withCopies(base["invoices.yaml"]!),
      }),
    ).toEqual([
      {
        code: "PACK_CHECK",
        message: `tables "invoices" and "copies" land at the same files ${landing}/erp.dbo.Invoices/*.parquet.`,
      },
    ]);
  });
});

describe("loads that hold only the window's changes", () => {
  const incremental = "      mode: incremental\n      watermark_column: modified_at\n";

  it("counts a date path coarser than the window as replacing the file", () => {
    const standard = withSettings(
      endAtFiles(base["standard.yaml"]!),
      `${incremental}      every: { frequency: Hour, interval: 1 }\n      path: "{object}/{object}_{yyyy}{MM}{dd}.parquet"\n`,
    );
    expect(problems({ "standard.yaml": standard })).toEqual([
      { code: "METHOD_CHECK", message: `"adf-copy" for table "invoices": ${lost}.` },
    ]);
  });

  it("writes one location wildcard for adjacent tokens", () => {
    const standard = withSettings(
      base["standard.yaml"]!,
      '      path: "{object}/{object}_{yyyy}{MM}{dd}.parquet"\n',
    );
    const { result } = generate({ "standard.yaml": standard });
    expect((result.model as ResolvedModel).tables[0]!.ingest!.output?.location).toBe(
      `${landing}/erp.dbo.Invoices/erp.dbo.Invoices_*.parquet`,
    );
  });

  const office = (options: string): Record<string, string> => {
    const project: Record<string, string> = tableProject(
      "microsoft-365",
      "  tenant: tenant\n  application_tenant: tenant\n  client_id: app\n  client_secret: ${secret:app-secret}",
      "BasicDataSet_v0.Message_v1",
    );
    project["standard.yaml"] = endAtFiles(
      `${project["standard.yaml"]}      runtime_kind: azure\n      format: json\n${options}`,
    );
    return project;
  };
  const dateFilter =
    "      source_options: { requires_date_filter: true, date_filter_column: CreatedDateTime }\n";

  it("keeps a file per run by default when a date filter makes each run hold one window", () => {
    const { result } = generate(office(dateFilter));
    expect(result.diagnostics).toEqual([]);
    expect((result.model as ResolvedModel).tables[0]!.ingest!.output?.loads).toBe("add");
  });

  it("refuses one replaced file when a date filter makes each run hold one window", () => {
    expect(problems(office(`${dateFilter}      layout: snapshot\n`))).toEqual([
      { code: "METHOD_CHECK", message: `"adf-table" for table "invoices": ${lost}.` },
    ]);
  });

  it("names every file of a Microsoft 365 connection once one table names its file", () => {
    const project = office(dateFilter);
    project["flow.yaml"] = twoTables(
      project["flow.yaml"]!,
      '  copies:\n    object: BasicDataSet_v0.Event_v1\n    contract: invoices\n    ingest: { with: { path: "{object}/{object}_{run}.json" } }\n',
    );
    project["invoices.yaml"] = withCopies(project["invoices.yaml"] ?? base["invoices.yaml"]!);
    const { result, files } = generate(project);
    expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
    const [first, second] = json(files, "pipeline/pl_erp_erp.json").properties.activities;
    expect(first.outputs[0].parameters).toEqual({
      folder: "erp/BasicDataSet_v0.Message_v1",
      file: "@{concat(formatDateTime(pipeline().parameters.windowStart, 'yyyyMMddHHmmss'), '_', pipeline().RunId, '.json')}",
    });
    expect(second.outputs[0].parameters).toEqual({
      folder: "erp/BasicDataSet_v0.Event_v1",
      file: "BasicDataSet_v0.Event_v1_@{pipeline().RunId}.json",
    });
  });
});
