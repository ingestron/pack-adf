import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { base, generate } from "./erp.js";
import { adf } from "../src/index.js";
const cases = JSON.parse(
  readFileSync(new URL("../spec/conformance/native-sources.json", import.meta.url), "utf8"),
) as {
  id: string;
  method: string;
  settings: Record<string, unknown>;
  object: string;
  options: Record<string, unknown>;
  expected: {
    service: string;
    dataset: string;
    source: string;
    version?: string;
    properties: Record<string, unknown>;
  };
}[];
const project = (entry: (typeof cases)[number]) => ({
  "standard.yaml":
    base["standard.yaml"]!.replace("adf-copy:", `${entry.method}:`) +
    Object.entries(entry.options)
      .map(([key, value]) => `      ${key}: ${JSON.stringify(value)}\n`)
      .join(""),
  "erp.yaml": `apiVersion: ingestron.io/v1\nkind: Connection\nid: erp\nconnector: ${entry.id}\nconnectivity: private\nsettings: ${JSON.stringify(entry.settings)}\n`,
  "flow.yaml": base["flow.yaml"]!.replace("erp.dbo.Invoices", entry.object),
});
it("has a conformance case for every ADF connector", () => {
  expect(cases.map((entry) => entry.id).sort()).toEqual(
    adf.connectors!.map((entry) => entry.id).sort(),
  );
});
describe.each(cases)("$id native conformance", (entry) => {
  it("builds native resources from definitions and rejects every missing required field", () => {
    const { result, files } = generate(project(entry));
    expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
    const resources = Object.values(files).map((file) => JSON.parse(file));
    const service = resources.find(
      (item) => item.name === (entry.method === "adf-copy" ? "ls_erp_erp_sales" : "ls_erp_erp"),
    );
    expect(service?.properties.type).toBe(entry.expected.service);
    expect(service).toBeDefined();
    expect(service.properties.typeProperties).toMatchObject(entry.expected.properties);
    if (entry.expected.version) expect(service.properties.version).toBe(entry.expected.version);
    expect(resources.some((item) => item.properties.type === entry.expected.dataset)).toBe(true);
    const pipeline = resources.find((item) => item.properties.activities);
    expect(pipeline.properties.activities[0].typeProperties.source.type).toBe(
      entry.expected.source,
    );
    for (const key of Object.keys(entry.settings)) {
      const settings = { ...entry.settings };
      delete settings[key];
      expect(
        generate(project({ ...entry, settings })).result.model,
        `missing ${key}`,
      ).toBeUndefined();
    }
  });
  it("rejects unknown settings before building", () => {
    expect(
      generate(
        project({ ...entry, settings: { ...entry.settings, unsupported_native_field: true } }),
      ).result.model,
    ).toBeUndefined();
  });
});
