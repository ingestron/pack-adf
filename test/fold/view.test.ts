// The model of Microsoft's export and of an ARM deployment, on hand-written inputs.
// Each expected name in spec/conformance/arm-parameters.json is what
// @microsoft/azure-data-factory-utilities 1.0.3 exported for the same input
// (spec/references.md), or Microsoft's documented example.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { armParameters, type ArmParameter, type Definition } from "../../src/fold/arm-export.js";
import { factoryView } from "../../src/fold/view.js";

const text = (data: unknown) => JSON.stringify(data);

const cases = JSON.parse(
  readFileSync(new URL("../../spec/conformance/arm-parameters.json", import.meta.url), "utf8"),
) as {
  name: string;
  definition: Definition;
  resources: Record<string, unknown>;
  parameters: ArmParameter[];
}[];

describe("the export's parameters", () => {
  it.each(cases)("$name", ({ definition, resources, parameters }) => {
    const files = Object.fromEntries(
      Object.entries(resources).map(([path, resource]) => [path, text(resource)]),
    );
    expect(armParameters(files, definition)).toEqual(parameters);
  });
});

describe("the view of one environment", () => {
  const definition = {
    "Microsoft.DataFactory/factories/triggers": { properties: { runtimeState: "-" } },
    "Microsoft.DataFactory/factories/linkedServices": {
      AzureKeyVault: { properties: { typeProperties: { baseUrl: "-" } } },
    },
  };
  const files = {
    "factory/arm-template-parameters-definition.json": text(definition),
    "factory/trigger/tr.json": text({ name: "tr", properties: { runtimeState: "Stopped" } }),
    "factory/linkedService/kv.json": text({
      name: "kv",
      properties: { type: "AzureKeyVault", typeProperties: { baseUrl: "<value of VAULT>" } },
    }),
    "parameters/prod.json": text({
      parameters: { tr_properties_runtimeState: { value: "Started" } },
    }),
  };

  it("sets each parameter from the environment's file, or as the pipeline supplies it", () => {
    const view = factoryView(files, "prod", {
      kv_properties_typeProperties_baseUrl: "${envvar:VAULT}",
    });
    expect(Object.keys(view).sort()).toEqual(["linkedService/kv.json", "trigger/tr.json"]);
    expect(JSON.parse(view["trigger/tr.json"]!).properties.runtimeState).toBe("Started");
    expect(JSON.parse(view["linkedService/kv.json"]!).properties.typeProperties.baseUrl).toBe(
      "${envvar:VAULT}",
    );
  });

  it("keeps the factory's value where nothing sets a parameter, so a missing one shows", () => {
    const view = factoryView(files, "test", {});
    expect(JSON.parse(view["trigger/tr.json"]!).properties.runtimeState).toBe("Stopped");
  });
});
