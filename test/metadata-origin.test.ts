// A table with no contract, whose columns and key come from source metadata, builds as a
// table with a contract does (specification section 12.4).
import { memoryFiles } from "@ingestron/config";
import { resolveDefinitions } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { adf } from "../src/index.js";
import { base } from "./erp.js";
import { store } from "./store-pack.js";
import { tableProject } from "./table-project.js";

const columns = [
  "{ name: invoice_id, sourceType: int, logicalType: integer, primaryKeyPosition: 1, required: true }",
  "{ name: amount, sourceType: decimal, logicalType: number, required: false }",
];

/** A `SourceMetadata` document of the ERP connection's one table. */
function metadata(object: string) {
  return [
    "apiVersion: ingestron.io/v1",
    "kind: SourceMetadata",
    "id: erp",
    "connection: erp",
    "tables:",
    `  - object: ${object}`,
    "    captured: { at: 2026-11-12T09:30:00Z, from: catalog, file: erp.csv }",
    "    columns:",
    ...columns.map((column) => `      - ${column}`),
    "",
  ].join("\n");
}

function generate(changes: Record<string, string>) {
  const result = resolveDefinitions(memoryFiles({ ...base, ...changes }), {
    packs: [store, adf],
    environment: "dev",
  });
  return { result, files: result.model ? adf.build(result.model) : {} };
}

/** The files with the flow's table naming no contract; its metadata stands in for one. */
function withoutContract(files: Record<string, string>) {
  const flow = files["flow.yaml"] ?? base["flow.yaml"]!;
  return { ...files, "flow.yaml": flow.replace(", contract: invoices", "") };
}

describe("a table with no contract", () => {
  it("maps the metadata's columns in a native tabular copy", () => {
    const settings =
      "  server: source.example.test\n  user: reader\n  password: ${secret:source-password}\n  database: sales";
    const { result, files } = generate({
      ...withoutContract(tableProject("postgresql", settings, "sales.orders")),
      "erp.metadata.yaml": metadata("sales.orders"),
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.model?.tables[0]?.contract).toMatchObject({
      id: "erp:sales.orders",
      origin: "metadata",
    });
    const pipeline = Object.entries(files).find(([path]) => path.startsWith("pipeline/"))!;
    const activity = JSON.parse(pipeline[1]).properties.activities[0];
    expect(activity.typeProperties.translator.mappings).toEqual([
      { source: { name: "invoice_id" }, sink: { name: "invoice_id" } },
      { source: { name: "amount" }, sink: { name: "amount" } },
    ]);
  });

  it("selects the metadata's columns when copying from SQL Server", () => {
    const { result, files } = generate({
      ...withoutContract({}),
      "erp.metadata.yaml": metadata("erp.dbo.Invoices"),
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.model?.tables[0]?.contract.origin).toBe("metadata");
    expect(Object.values(files).join("\n")).toContain(
      "SELECT [invoice_id], [amount] FROM [dbo].[Invoices]",
    );
  });

  it("copies files as they are, and builds", () => {
    const { result, files } = generate({
      ...withoutContract({
        "standard.yaml": base["standard.yaml"]!.replace(
          "adf-copy:",
          "adf-files:\n      format: csv",
        ),
        "erp.yaml":
          "apiVersion: ingestron.io/v1\nkind: Connection\nid: erp\nconnector: amazon-s3\nconnectivity: private\nsettings:\n  access_key: synthetic-access\n  secret_key: ${secret:s3-key}\n",
        "flow.yaml": base["flow.yaml"]!.replace("erp.dbo.Invoices", "sales/orders"),
      }),
      "erp.metadata.yaml": metadata("sales/orders"),
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.model?.tables[0]?.contract.columns.map((column) => column.name)).toEqual([
      "invoice_id",
      "amount",
    ]);
    const activity = JSON.parse(files["pipeline/pl_erp_erp.json"]!).properties.activities[0];
    expect(activity.description).toBe("Copies the files of sales/orders to landing as they are.");
    expect(activity.typeProperties.source.type).toBe("BinarySource");
  });

  it("refuses an audit column named like one of the metadata's columns", () => {
    const standard = base["standard.yaml"]!.replace(
      "      start: 2026-10-01T00:00:00Z\n",
      "      start: 2026-10-01T00:00:00Z\n      audit_columns: { AMOUNT: run.id }\n",
    );
    const { result } = generate({
      ...withoutContract({ "standard.yaml": standard }),
      "erp.metadata.yaml": metadata("erp.dbo.Invoices"),
    });
    expect(result.diagnostics.map((item) => item.message).join("\n")).toContain(
      'audit column "AMOUNT" is a column of the source metadata; rename it',
    );
  });

  it("refuses a column path for a column the metadata does not have", () => {
    const project = tableProject("rest", "  url: https://source.example.test", "orders");
    project["standard.yaml"] += '      source_options: { column_paths: { missing: "$.id" } }\n';
    const { result } = generate({
      ...withoutContract(project),
      "erp.metadata.yaml": metadata("orders"),
    });
    expect(result.diagnostics.map((item) => item.message).join("\n")).toContain(
      "column_paths.missing is not a column of the source metadata",
    );
  });
});

describe("settings that name the table's columns", () => {
  it("say the table's columns, since a table's columns can come from source metadata", () => {
    const files = adf.methods["adf-files"]!.settings as {
      properties: { schema_hints: { description: string } };
    };
    expect(files.properties.schema_hints.description).toBe(
      "Pass the table's column types to the reader, so CSV and JSON columns are typed.",
    );
    const table = adf.methods["adf-table"]!.settings as {
      properties: { source_options: { properties: { column_paths: { description: string } } } };
    };
    expect(table.properties.source_options.properties.column_paths.description).toContain(
      "the table's column names mapped to native JSON paths",
    );
  });
});
