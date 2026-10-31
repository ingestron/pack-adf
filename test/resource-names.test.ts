import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { base, generate } from "./erp.js";
const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`../spec/conformance/${name}.json`, import.meta.url), "utf8"));
const naming = read("resource-names") as {
  names: Record<string, string>;
  invalid_names: string[];
  invalid_role: string;
};
const cases = read("native-sources") as {
  id: string;
  method: string;
  settings: object;
  object: string;
  options: object;
}[];
const project = (entry: (typeof cases)[number], names = naming.names) => ({
  "standard.yaml":
    base["standard.yaml"]!.replace("adf-copy:", `${entry.method}:`) +
    Object.entries({ ...entry.options, resource_names: names })
      .map(([key, value]) => `      ${key}: ${JSON.stringify(value)}\n`)
      .join(""),
  "erp.yaml": `apiVersion: ingestron.io/v1\nkind: Connection\nid: erp\nconnector: ${entry.id}\nconnectivity: private\nsettings: ${JSON.stringify(entry.settings)}\n`,
  "flow.yaml": base["flow.yaml"]!.replace("erp.dbo.Invoices", entry.object),
});
it.each(cases)("configures every generated name and reference for $id", (entry) => {
  const { result, files } = generate(project(entry));
  expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
  const resources = Object.entries(files).map(([path, text]) => ({ path, ...JSON.parse(text) }));
  const names = new Set(Object.values(naming.names));
  for (const resource of resources) {
    expect(names.has(resource.name), resource.path).toBe(true);
    expect(resource.path).toContain(`/${resource.name}.json`);
    checkReferences(resource, files);
  }
  const pipeline = resources.find((item) => item.properties.activities);
  expect(pipeline.properties.activities[0].name).toBe(naming.names.copy_activity);
});
function checkReferences(value: unknown, files: Record<string, string>): void {
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  const folders: Record<string, string> = {
    LinkedServiceReference: "linkedService",
    DatasetReference: "dataset",
    PipelineReference: "pipeline",
  };
  const folder = folders[String(object.type)];
  if (folder) expect(files[`${folder}/${String(object.referenceName)}.json`]).toBeDefined();
  for (const child of Object.values(object)) checkReferences(child, files);
}
it.each(naming.invalid_names)("rejects invalid source service name %s", (name) => {
  expect(
    generate(project(cases[0]!, { source_linked_service: name })).result.model,
  ).toBeUndefined();
});
it("rejects unknown resource-name roles", () => {
  expect(
    generate(project(cases[0]!, { [naming.invalid_role]: "Name" })).result.model,
  ).toBeUndefined();
});
it("resolves existing YAML environment references without a second naming syntax", () => {
  const { result, files } = generate(
    project(cases[0]!, { pipeline: "pl_${project.id}_${environment.name}" }),
  );
  expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
  expect(files["pipeline/pl_erp_dev.json"]).toBeDefined();
});
it("rejects resource names which collide regardless of case", () => {
  const { result } = generate(
    project(cases[0]!, { source_linked_service: "ls_erp_landing".toUpperCase() }),
  );
  expect(result.model).toBeUndefined();
});
it("keeps fixed resource names protected", () => {
  const changes = project(cases[0]!, { pipeline: "CompanyPipeline" });
  changes["standard.yaml"] +=
    "  fixed:\n    adf-table:\n      resource_names: { pipeline: CompanyPipeline }\n";
  changes["flow.yaml"] += "ingest:\n  with:\n    resource_names: { pipeline: Override }\n";
  expect(generate(changes).result.diagnostics.some((item) => item.code === "FIXED_SETTING")).toBe(
    true,
  );
});
