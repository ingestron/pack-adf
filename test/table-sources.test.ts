import { describe, expect, it } from "vitest";
import { generate } from "./erp.js";

const cases = [
  ["postgresql", "PostgreSqlV2", "PostgreSqlV2Table", "PostgreSqlV2Source"],
  ["azure-postgresql", "AzurePostgreSql", "AzurePostgreSqlTable", "AzurePostgreSqlSource"],
  ["mysql", "MySql", "MySqlTable", "MySqlSource"],
  ["oracle", "Oracle", "OracleTable", "OracleSource"],
  [
    "amazon-rds-oracle",
    "AmazonRdsForOracle",
    "AmazonRdsForOracleTable",
    "AmazonRdsForOracleSource",
  ],
  ["amazon-redshift", "AmazonRedshift", "AmazonRedshiftTable", "AmazonRedshiftSource"],
];
import { tableProject } from "./table-project.js";

describe("native tabular copying", () => {
  for (const [connector, service, dataset, source] of cases) {
    it(`builds ${connector} with native resources and mapped contract columns`, () => {
      const settings = [
        "  server: source.example.test",
        "  user: reader",
        "  password: ${secret:source-password}",
      ];
      if (!connector!.includes("oracle")) settings.push("  database: sales");
      const object = connector === "mysql" ? "orders" : "sales.orders";
      const { result, files } = generate(tableProject(connector!, settings.join("\n"), object));
      expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
      const services = Object.entries(files)
        .filter(([path]) => path.startsWith("linkedService/"))
        .map(([, text]) => JSON.parse(text));
      expect(
        services.find((entry) => entry.properties.type === service)?.properties.typeProperties
          .password,
      ).toMatchObject({ type: "AzureKeyVaultSecret", secretName: "source-password" });
      expect(
        Object.values(files)
          .map((text) => JSON.parse(text))
          .some((entry) => entry.properties.type === dataset),
      ).toBe(true);
      const pipeline = Object.entries(files).find(([path]) => path.startsWith("pipeline/"))!;
      const activity = JSON.parse(pipeline[1]).properties.activities[0];
      expect(activity.typeProperties.source.type).toBe(source);
      expect(activity.typeProperties.translator.mappings[0]).toEqual({
        source: { name: "invoice_id" },
        sink: { name: "invoice_id" },
      });
    });
  }
  it("rejects literal credentials and missing required database settings", () => {
    const { result } = generate(
      tableProject(
        "postgresql",
        "  server: source.example.test\n  user: reader\n  password: literal",
      ),
    );
    expect(result.model).toBeUndefined();
    expect(result.diagnostics.map((item) => item.message).join("\n")).toContain("database");
    expect(result.diagnostics.map((item) => item.message).join("\n")).toContain("password");
  });
  it("rejects incremental mode until a native implementation supports it", () => {
    const project = tableProject(
      "postgresql",
      "  server: source.example.test\n  database: sales\n  user: reader\n  password: ${secret:source-password}",
    );
    project["standard.yaml"] += "      mode: incremental\n";
    expect(generate(project).result.model).toBeUndefined();
  });
});
