import { expect, it } from "vitest";
import { generate, json } from "./erp.js";
import { tableProject } from "./table-project.js";
const credentials =
  "  server: source.example.test\n  database: sales\n  user: reader\n  password: ${secret:source-password}";
it("verifies PostgreSQL certificates with the documented SSL mode", () => {
  const { files } = generate(tableProject("postgresql", credentials));
  expect(json(files, "linkedService/ls_erp_erp.json").properties.typeProperties.sslMode).toBe(5);
});
it("refuses source names which would overwrite shared landing resources", () => {
  const project = tableProject("postgresql", credentials);
  project["erp.yaml"] = project["erp.yaml"]!.replace("id: erp", "id: landing");
  project["flow.yaml"] = project["flow.yaml"]!.replace("source: erp", "source: landing");
  expect(generate(project).result.model).toBeUndefined();
});
it("copies the last Open Hub request for full snapshots", () => {
  const project = tableProject(
    "sap-bw-open-hub",
    '  server: sap.example.test\n  system_number: "00"\n  client_id: "100"\n  user: reader\n  password: ${secret:sap-password}',
    "SALES",
  );
  const { result, files } = generate(project);
  expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
  expect(
    json(files, "pipeline/pl_erp_erp.json").properties.activities[0].typeProperties.source
      .excludeLastRequest,
  ).toBe(false);
});
it("allows a Web table index and rejects its omission", () => {
  const project = tableProject("web-table", "  url: https://source.example.test", "reports");
  expect(generate(project).result.model).toBeUndefined();
  project["standard.yaml"] += "      source_options: { table_index: 0 }\n";
  const { result, files } = generate(project);
  expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
  expect(json(files, "dataset/ds_erp_erp_invoices.json").properties.typeProperties.index).toBe(0);
});
it.each(["odbc", "informix", "microsoft-access"])(
  "uses documented userName for %s",
  (connector) => {
    const { files } = generate(
      tableProject(
        connector,
        "  connection_string: DSN=synthetic\n  user: reader\n  password: ${secret:driver-password}",
        "orders",
      ),
    );
    const properties = json(files, "linkedService/ls_erp_erp.json").properties.typeProperties;
    expect(properties.userName).toBe("reader");
    expect(properties.username).toBeUndefined();
  },
);
it("rejects unknown REST pagination rules and unmapped contract column names", () => {
  const project = tableProject("rest", "  url: https://source.example.test", "orders");
  project["standard.yaml"] +=
    '      source_options: { pagination: { arbitrary: "next" }, column_paths: { missing: "$.id" } }\n';
  expect(generate(project).result.model).toBeUndefined();
});
