import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { base, generate, json } from "./erp.js";
import { tableProject } from "./table-project.js";
const cases = JSON.parse(
  readFileSync(new URL("../spec/conformance/web-options.json", import.meta.url), "utf8"),
) as {
  id: string;
  method: string;
  settings: object;
  object: string;
  options: object;
  resource_path: string;
  property_path: (string | number)[];
  expected: object;
}[];
function project(entry: (typeof cases)[number]) {
  return {
    "standard.yaml":
      base["standard.yaml"]!.replace("adf-copy:", `${entry.method}:`) +
      Object.entries(entry.options)
        .map(([key, value]) => `      ${key}: ${JSON.stringify(value)}\n`)
        .join(""),
    "erp.yaml": `apiVersion: ingestron.io/v1\nkind: Connection\nid: erp\nconnector: ${entry.id}\nconnectivity: private\nsettings: ${JSON.stringify(entry.settings)}\n`,
    "flow.yaml": base["flow.yaml"]!.replace("erp.dbo.Invoices", entry.object),
  };
}
it.each(cases)("configures $id required web options from definitions", (entry) => {
  const { result, files } = generate(project(entry));
  expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
  const properties = entry.property_path.reduce(
    (value, key) => value[key],
    json(files, entry.resource_path),
  );
  expect(properties).toMatchObject(entry.expected);
});
it("rejects a REST resource audience for Anonymous", () => {
  expect(
    generate(
      tableProject(
        "rest",
        "  url: https://source.example.test\n  resource: https://source.example.test",
        "orders",
      ),
    ).result.model,
  ).toBeUndefined();
});
it("rejects a GET body or HTTP options for a different file connector", () => {
  const changes = project(cases[1]!);
  changes["standard.yaml"] = changes["standard.yaml"]!.replace('"POST"', '"GET"');
  expect(generate(changes).result.model).toBeUndefined();
  changes["erp.yaml"] = changes["erp.yaml"]!.replace("connector: http", "connector: hdfs");
  expect(generate(changes).result.model).toBeUndefined();
});
