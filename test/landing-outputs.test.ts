// Where ADF says each table's files land, and the layouts it refuses.
import type { ResolvedModel } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { base, generate, landing } from "./erp.js";
import { tableProject } from "./table-project.js";

const endAtFiles = (standard: string) =>
  standard.replace("packs: [store@1, adf@1]", "packs: [adf@1]\nstore: { default: none }");
const withSettings = (standard: string, settings: string) =>
  standard.replace(
    "      start: 2026-10-01T00:00:00Z\n",
    `      start: 2026-10-01T00:00:00Z\n${settings}`,
  );

function outputOf(changes: Record<string, string>) {
  const { result } = generate(changes);
  expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
  return (result.model as ResolvedModel).tables[0]!.ingest!.output;
}

const problems = (changes: Record<string, string>) =>
  generate(changes).result.diagnostics.map(({ code, message }) => ({ code, message }));

describe("outputs", () => {
  it("reports the snapshot file of adf-copy", () => {
    expect(outputOf({ "standard.yaml": endAtFiles(base["standard.yaml"]!) })).toEqual({
      location: `${landing}/erp.dbo.Invoices/erp.dbo.Invoices.parquet`,
      format: "parquet",
      loads: "replace",
    });
  });

  it("reports every increment of adf-copy", () => {
    expect(outputOf({})).toEqual({
      location: `${landing}/erp.dbo.Invoices/*.parquet`,
      format: "parquet",
      loads: "add",
    });
  });

  it("reports Microsoft 365 files as JSON", () => {
    const project = tableProject(
      "microsoft-365",
      "  tenant: tenant\n  application_tenant: tenant\n  client_id: app\n  client_secret: ${secret:app-secret}",
      "BasicDataSet_v0.Message_v1",
    );
    project["standard.yaml"] +=
      "      runtime_kind: azure\n      format: json\n      source_options: { requires_date_filter: true, date_filter_column: CreatedDateTime }\n";
    expect(outputOf(project)?.format).toBe("json");
  });

  const files = (format: string) => ({
    "standard.yaml": base["standard.yaml"]!.replace(
      "adf-copy:",
      `adf-files:\n      format: ${format}`,
    ),
    "erp.yaml":
      "apiVersion: ingestron.io/v1\nkind: Connection\nid: erp\nconnector: amazon-s3\nconnectivity: private\nsettings:\n  access_key: synthetic-access\n  secret_key: ${secret:s3-key}\n",
    "flow.yaml": base["flow.yaml"]!.replace("erp.dbo.Invoices", "sales/orders"),
  });

  it("reports the files adf-files copies when other packs can read their format", () => {
    expect(outputOf(files("csv"))).toEqual({
      location: `${landing}/sales/orders/**`,
      format: "csv",
      loads: "add",
    });
  });

  it("reports nothing for files in a format other packs cannot read", () => {
    expect(outputOf(files("xml"))).toBeUndefined();
  });
});

describe("checks", () => {
  const lost =
    "each run holds only the window's changes and replaces the last file, so changes would be lost; keep a file per run (layout: increments, or a path with {run}), or add a store step";
  const incremental = "      mode: incremental\n      watermark_column: modified_at\n";

  it("refuses incremental loads into one replaced file with nothing to merge them", () => {
    const standard = withSettings(endAtFiles(base["standard.yaml"]!), incremental);
    expect(problems({ "standard.yaml": standard })).toEqual([
      { code: "METHOD_CHECK", message: `"adf-copy" for table "invoices": ${lost}.` },
    ]);
  });

  it("refuses them for a path pattern without date or run tokens too", () => {
    const standard = withSettings(
      endAtFiles(base["standard.yaml"]!),
      `${incremental}      path: "{object}/latest.parquet"\n`,
    );
    expect(problems({ "standard.yaml": standard })).toEqual([
      { code: "METHOD_CHECK", message: `"adf-copy" for table "invoices": ${lost}.` },
    ]);
  });

  it("refuses layout and path together", () => {
    const standard = withSettings(
      endAtFiles(base["standard.yaml"]!),
      '      layout: snapshot\n      path: "{object}/{run}.parquet"\n',
    );
    expect(problems({ "standard.yaml": standard })).toEqual([
      {
        code: "METHOD_CHECK",
        message: '"adf-copy" for table "invoices": set layout or path, not both.',
      },
    ]);
  });

  it("names what is wrong with a path pattern", () => {
    const standard = withSettings(
      endAtFiles(base["standard.yaml"]!),
      '      path: "{table}.csv"\n',
    );
    expect(problems({ "standard.yaml": standard }).map((item) => item.message)).toEqual([
      '"adf-copy" for table "invoices": the path pattern "{table}.csv" uses an unknown token {table}; tokens: object, connection, yyyy, MM, dd, HH, run.',
      '"adf-copy" for table "invoices": the path pattern "{table}.csv" must end in .parquet.',
    ]);
  });

  it("refuses two tables that land at the same file", () => {
    const flow = base["flow.yaml"]!.replace(
      "  invoices: { object: erp.dbo.Invoices, contract: invoices }\n",
      "  invoices: { object: erp.dbo.Invoices, contract: invoices }\n  copies: { object: erp.dbo.Invoices, contract: invoices }\n",
    );
    const contract = base["invoices.yaml"]!.replace(
      "schema:\n",
      "schema:\n  - name: copies\n    logicalType: object\n    properties:\n      - { name: invoice_id, logicalType: integer }\n",
    );
    expect(
      problems({
        "standard.yaml": endAtFiles(base["standard.yaml"]!),
        "flow.yaml": flow,
        "invoices.yaml": contract,
      }),
    ).toEqual([
      {
        code: "PACK_CHECK",
        message: "ADF landing paths overlap for invoices and copies; use distinct landing folders.",
      },
    ]);
  });
});
