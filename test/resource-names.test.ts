import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { checkNameLengths } from "../src/resource-files.js";
import { base, generate } from "./erp.js";
const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`../spec/conformance/${name}.json`, import.meta.url), "utf8"));
const naming = read("resource-names") as {
  names: Record<string, string>;
  invalid_names: string[];
  invalid_role: string;
  name_limits: { resource: number; copy_activity: number };
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
  // Integration runtimes keep the names the settings give them.
  for (const resource of resources.filter((item) => !item.path.startsWith("integrationRuntime/"))) {
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
    IntegrationRuntimeReference: "integrationRuntime",
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

const named = (length: number, letter = "n") => letter + "x".repeat(length - 1);
it.each([
  ["source_linked_service", naming.name_limits.resource],
  ["copy_activity", naming.name_limits.copy_activity],
])(
  "accepts a %s name of the most characters Microsoft's export accepts, and no more",
  (role, limit) => {
    expect(generate(project(cases[0]!, { [role]: named(limit) })).result.model).toBeDefined();
    const { result } = generate(project(cases[0]!, { [role]: named(limit + 1) }));
    expect(result.model).toBeUndefined();
    expect(result.diagnostics.map((item) => item.message).join("\n")).toContain(role);
  },
);
it("refuses a default name longer than Microsoft's export accepts, naming it and the fix", () => {
  const connection = named(140, "c");
  const changes = project(cases[0]!, {});
  changes["erp.yaml"] = changes["erp.yaml"]!.replace("id: erp", `id: ${connection}`);
  changes["flow.yaml"] = changes["flow.yaml"]!.replace("source: erp", `source: ${connection}`);
  const messages = generate(changes).result.diagnostics.map((item) => item.message);
  expect(messages).toContain(
    `The ADF linked service name "ls_erp_${connection}" has ${connection.length + 7} characters, more than the 140 Microsoft's export accepts; set resource_names.source_linked_service to a shorter name, or shorten the ids the name is made from.`,
  );
});
it("refuses a derived name longer than Microsoft's export accepts, inside a ForEach too", () => {
  const pipeline = (name: string, inner: string) => ({
    [`pipeline/${name}.json`]: JSON.stringify({
      name,
      properties: {
        activities: [{ name: "for_each_table", typeProperties: { activities: [{ name: inner }] } }],
      },
    }),
  });
  expect(() => checkNameLengths(pipeline(named(140, "p"), named(55, "a")))).not.toThrow();
  expect(() => checkNameLengths(pipeline(named(141, "p"), "copy"))).toThrow(
    `The ADF pipeline name "${named(141, "p")}" has 141 characters, more than the 140 Microsoft's export accepts; shorten the project id, which after_copy's parent pipeline and trigger are named from, or the resource_names role the name comes from`,
  );
  expect(() => checkNameLengths(pipeline("pl_erp", named(56, "a")))).toThrow(
    `The ADF activity name "${named(56, "a")}" has 56 characters, more than the 55 Microsoft's export accepts; shorten it in pipeline pl_erp with resource_names.copy_activity, or shorten the table name it is made from`,
  );
});
