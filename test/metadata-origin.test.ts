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
    expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
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
    expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
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
    expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
    expect(result.model?.tables[0]?.contract.columns.map((column) => column.name)).toEqual([
      "invoice_id",
      "amount",
    ]);
    expect(Object.keys(files).some((path) => path.startsWith("pipeline/"))).toBe(true);
  });
});
