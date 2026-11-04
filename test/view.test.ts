// The model of Microsoft's export and of an ARM deployment, on hand-written inputs.
// Each expected name is what @microsoft/azure-data-factory-utilities 1.0.3 exported
// for the same input (spec/references.md), or Microsoft's documented example.
import { describe, expect, it } from "vitest";
import { armParameters } from "../src/arm-export.js";
import { factoryView } from "../src/view.js";

const pipelines = "Microsoft.DataFactory/factories/pipelines";
const text = (data: unknown) => JSON.stringify(data);

const pipeline = text({
  name: "pl_x",
  properties: {
    activities: [
      { name: "start", typeProperties: { url: "https://a/start" } },
      {
        name: "stop",
        typeProperties: { url: { value: "@concat('https://a', 'stop')", type: "Expression" } },
      },
      {
        name: "loop",
        typeProperties: {
          activities: [
            {
              name: "copy",
              outputs: [{ parameters: { folder: "x/y" } }],
              typeProperties: { source: { additionalColumns: [{ name: "_e", value: "dev" }] } },
            },
          ],
        },
      },
    ],
    parameters: { tables: { type: "array", defaultValue: [{ folder: "x/y" }] } },
  },
});

describe("the export's parameters", () => {
  it("name an activity's value by the indexes of the activities, not by the arrays' keys", () => {
    const definition = {
      [pipelines]: { properties: { activities: [{ typeProperties: { url: "-" } }] } },
    };
    expect(armParameters({ "pipeline/pl_x.json": pipeline }, definition)).toEqual([
      {
        name: "pl_x_properties_0_typeProperties_url",
        file: "pipeline/pl_x.json",
        path: ["properties", "activities", 0, "typeProperties", "url"],
        type: "string",
      },
      {
        name: "pl_x_properties_1_typeProperties_url",
        file: "pipeline/pl_x.json",
        path: ["properties", "activities", 1, "typeProperties", "url", "value"],
        type: "string",
      },
    ]);
  });

  it("follow nested activities and other arrays of objects", () => {
    const definition = {
      [pipelines]: {
        properties: {
          activities: [
            {
              typeProperties: {
                activities: [{ outputs: [{ parameters: { folder: "-" } }] }],
              },
            },
          ],
        },
      },
    };
    expect(
      armParameters({ "pipeline/pl_x.json": pipeline }, definition).map((item) => item.name),
    ).toEqual(["pl_x_properties_2_typeProperties_0_0_parameters_folder"]);
  });

  it("leave a whole list's key out of its name", () => {
    const definition = {
      [pipelines]: {
        properties: {
          activities: [
            {
              typeProperties: {
                activities: [{ typeProperties: { source: { additionalColumns: "-::array" } } }],
              },
            },
          ],
          parameters: { tables: { defaultValue: "-::array" } },
        },
      },
    };
    expect(armParameters({ "pipeline/pl_x.json": pipeline }, definition)).toMatchObject([
      { name: "pl_x_properties_2_typeProperties_0_typeProperties_source", type: "array" },
      { name: "pl_x_properties_parameters_tables", type: "array" },
    ]);
  });

  it("apply a linked service's definition to the linked services of that type only", () => {
    const definition = {
      "Microsoft.DataFactory/factories/linkedServices": {
        AzureBlobFS: { properties: { typeProperties: { url: "-" } } },
      },
    };
    const files = {
      "linkedService/ls_lake.json": text({
        name: "ls_lake",
        properties: { type: "AzureBlobFS", typeProperties: { url: "u" } },
      }),
      "linkedService/ls_web.json": text({
        name: "ls_web",
        properties: { type: "HttpServer", typeProperties: { url: "u" } },
      }),
    };
    expect(armParameters(files, definition).map((item) => item.name)).toEqual([
      "ls_lake_properties_typeProperties_url",
    ]);
  });

  it("take a given name in place of the property's, or alone after a dash", () => {
    const definition = {
      "Microsoft.DataFactory/factories/triggers": {
        properties: {
          typeProperties: { recurrence: { interval: "=:triggerSuffix:int", frequency: "=:-freq" } },
        },
      },
    };
    const trigger = text({
      name: "tr",
      properties: { typeProperties: { recurrence: { interval: 1, frequency: "Day" } } },
    });
    expect(armParameters({ "trigger/tr.json": trigger }, definition)).toMatchObject([
      { name: "tr_properties_typeProperties_recurrence_triggerSuffix", type: "int" },
      { name: "tr_freq", type: "string" },
    ]);
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
