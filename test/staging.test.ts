import { expect, it } from "vitest";
import { generate, json } from "./erp.js";
import { tableProject } from "./table-project.js";
const project = () => {
  const value = tableProject(
    "snowflake",
    "  account: example-organisation\n  database: sales\n  warehouse: export\n  user: reader\n  private_key: ${secret:snowflake-key}",
    "sales.orders",
  );
  value["standard.yaml"] +=
    '      source_options: { staging_sas: "${secret:staging-sas}", staging_path: "staging/orders" }\n';
  return value;
};
it("generates staging from definitions with Key Vault authentication and merged output", () => {
  const { result, files } = generate(project());
  expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
  expect(
    json(files, "linkedService/ls_erp_erp_staging.json").properties.typeProperties.sasUri
      .secretName,
  ).toBe("staging-sas");
  const copy = json(files, "pipeline/pl_erp_erp.json").properties.activities[0].typeProperties;
  expect(copy.enableStaging).toBe(true);
  expect(copy.stagingSettings.path).toBe("staging/orders");
  expect(copy.source.exportSettings.type).toBe("SnowflakeExportCopyCommand");
  expect(copy.sink.storeSettings.copyBehavior).toBe("MergeFiles");
});
it("rejects different staging credentials for tables sharing one connection", () => {
  const value = project();
  value["flow.yaml"] +=
    '  returns:\n    object: sales.returns\n    contract: invoices\n    ingest:\n      with:\n        source_options: { staging_sas: "${secret:another-sas}", staging_path: "staging/returns" }\n';
  const { result } = generate(value);
  expect(result.model).toBeUndefined();
  expect(result.diagnostics.map((item) => item.message).join(" ")).toContain("share");
});
it("rejects overlapping landing folders for different selections", () => {
  const value = tableProject("rest", "  url: https://source.example.test", "orders");
  value["flow.yaml"] += "  other: { object: orders/items, contract: invoices }\n";
  const { result } = generate(value);
  expect(result.model).toBeUndefined();
  expect(result.diagnostics.map((item) => item.message).join(" ")).toContain(
    "landing paths overlap",
  );
});
