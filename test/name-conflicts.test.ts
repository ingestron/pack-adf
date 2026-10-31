import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { base, generate } from "./erp.js";
const cases = JSON.parse(
  readFileSync(new URL("../spec/conformance/native-sources.json", import.meta.url), "utf8"),
) as {
  id: string;
  method: string;
  settings: object;
  object: string;
  options: object;
}[];
function twoTables(id: string, names: object = {}, secondNames: object = {}) {
  const entry = cases.find((item) => item.id === id)!;
  return {
    "standard.yaml":
      base["standard.yaml"]!.replace("adf-copy:", `${entry.method}:`) +
      Object.entries({ ...entry.options, resource_names: names })
        .map(([key, value]) => `      ${key}: ${JSON.stringify(value)}\n`)
        .join(""),
    "erp.yaml": `apiVersion: ingestron.io/v1\nkind: Connection\nid: erp\nconnector: ${id}\nconnectivity: private\nsettings: ${JSON.stringify(entry.settings)}\n`,
    "flow.yaml": `apiVersion: ingestron.io/v1\nkind: Flow\nid: erp\nsource: erp\ntables:\n  first: { object: ${entry.object}, contract: invoices }\n  second: { object: ${entry.object}Other, contract: invoices, ingest: { with: { resource_names: ${JSON.stringify(secondNames)} } } }\n`,
  };
}
it.each([
  ["sqlserver", "pipeline"],
  ["sqlserver", "source_dataset"],
  ["files", "source_linked_service"],
  ["files", "source_dataset"],
  ["postgresql", "trigger"],
  ["postgresql", "source_linked_service"],
  ["snowflake", "staging_linked_service"],
  ["microsoft-365", "json_landing_linked_service"],
  ["microsoft-365", "json_landing_dataset"],
  ["postgresql", "key_vault_linked_service"],
  ["files", "landing_files_dataset"],
])("rejects disagreeing shared %s %s names", (id, role) => {
  const { result } = generate(twoTables(id, {}, { [role]: "DifferentName" }));
  expect(result.model).toBeUndefined();
  expect(
    result.diagnostics.some((item) => item.message.includes(`resource_names.${role} must agree`)),
  ).toBe(true);
});
it("permits distinct datasets for native tables in one pipeline", () => {
  const { result, files } = generate(
    twoTables("postgresql", {}, { source_dataset: "OtherDataset" }),
  );
  expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
  expect(files["dataset/OtherDataset.json"]).toBeDefined();
});
it.each(["sqlserver", "files", "postgresql"])("rejects duplicate activity names for %s", (id) => {
  const { result } = generate(
    twoTables(id, { copy_activity: "SameActivity" }, { copy_activity: "sameactivity" }),
  );
  expect(result.model).toBeUndefined();
  expect(result.diagnostics.some((item) => item.message.includes("duplicate activity names"))).toBe(
    true,
  );
});
it("allows hyphens in pipeline and trigger names", () => {
  const { result, files } = generate(
    twoTables("postgresql", { pipeline: "Read-Source", trigger: "Read-Window" }),
  );
  expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
  expect(files["pipeline/Read-Source.json"]).toBeDefined();
  expect(files["trigger/Read-Window.json"]).toBeDefined();
});
