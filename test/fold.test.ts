// One factory for every environment: the factory's Git folder with the first
// environment's values, a parameter definition for what differs, and an ARM
// parameter file per environment.
import { describe, expect, it } from "vitest";
import { adf } from "../src/index.js";
import { base } from "./erp.js";
import {
  linkedRuntime,
  sharedRuntime,
  erpEnvironments,
  erpProject,
  fold,
  foldFailures,
  jsonOf,
  parametersOf,
  resolveAll,
} from "./fold-helpers.js";

const three = resolveAll(erpEnvironments(), ["dev", "test", "prod"]);

describe("the folded files", () => {
  it("lay out the factory's folder and a parameter file per environment", () => {
    const paths = Object.keys(fold(three).files);
    expect(paths.filter((path) => !path.startsWith("factory/"))).toEqual([
      "parameters/dev.json",
      "parameters/prod.json",
      "parameters/test.json",
    ]);
    expect(paths).toContain("factory/arm-template-parameters-definition.json");
    const resources = paths.filter((path) => /^factory\/[a-zA-Z]+\//.test(path));
    expect(resources.map((path) => path.slice("factory/".length))).toEqual(
      Object.keys(adf.build(three.dev!)).sort(),
    );
  });

  it("hold the first environment's values in the factory", () => {
    const files = fold(three).files;
    expect(
      jsonOf(files, "factory/linkedService/ls_erp_landing.json").properties.typeProperties,
    ).toEqual({ url: "https://erplakedev.dfs.core.windows.net" });
  });

  it("define a parameter only for the properties that differ, with no default", () => {
    expect(jsonOf(fold(three).files, "factory/arm-template-parameters-definition.json")).toEqual({
      "Microsoft.DataFactory/factories/linkedServices": {
        AzureKeyVault: { properties: { typeProperties: { baseUrl: "-" } } },
        AzureBlobFS: { properties: { typeProperties: { url: "-" } } },
      },
      "Microsoft.DataFactory/factories/pipelines": {
        properties: {
          activities: [
            {
              typeProperties: {
                activities: [
                  {
                    typeProperties: {
                      source: { additionalColumns: [{ value: "-" }] },
                      url: "-",
                    },
                  },
                ],
                url: "-",
              },
            },
          ],
        },
      },
      "Microsoft.DataFactory/factories/triggers": { properties: { runtimeState: "-" } },
    });
  });

  it("set every parameter for every environment, the first one included", () => {
    const files = fold(three).files;
    const names = (target: string) => Object.keys(parametersOf(files, target));
    expect(names("dev")).toEqual(names("test"));
    expect(names("dev")).toEqual(names("prod"));
    expect(parametersOf(files, "dev")).toMatchObject({
      ls_erp_keyvault_properties_typeProperties_baseUrl: "https://kv-erp-dev.vault.azure.net",
      ls_erp_landing_properties_typeProperties_url: "https://erplakedev.dfs.core.windows.net",
      pl_erp_erp_properties_0_typeProperties_0_typeProperties_source_0_value: "dev",
      tr_erp_every_24_hour_properties_runtimeState: "Stopped",
    });
    expect(parametersOf(files, "test")).toMatchObject({
      ls_erp_landing_properties_typeProperties_url: "https://erplake.dfs.core.windows.net",
      tr_erp_every_24_hour_properties_runtimeState: "Stopped",
    });
    expect(parametersOf(files, "prod")).toMatchObject({
      ls_erp_landing_properties_typeProperties_url: "https://erplake.dfs.core.windows.net",
      tr_erp_every_24_hour_properties_runtimeState: "Started",
    });
  });

  it("write ARM deployment parameter files without factoryName, which each stage supplies", () => {
    const parameters = jsonOf(fold(three).files, "parameters/prod.json");
    expect(parameters.$schema).toBe(
      "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    );
    expect(parameters.contentVersion).toBe("1.0.0.0");
    expect(parameters.parameters.factoryName).toBeUndefined();
  });

  it("give each environment what building it alone gives", () => {
    expect(foldFailures(three)).toEqual([]);
  });
});

describe("one environment", () => {
  const one = resolveAll({ ...base, "project.yaml": erpProject(["  dev: {}"]) }, ["dev"]);

  it("is the environment's own factory, with an empty definition and parameter file", () => {
    const { files, problems } = fold(one);
    expect(problems.filter((problem) => problem.code !== "PACK_NOTICE")).toEqual([]);
    expect(jsonOf(files, "factory/arm-template-parameters-definition.json")).toEqual({});
    expect(parametersOf(files, "dev")).toEqual({});
    for (const [path, text] of Object.entries(adf.build(one.dev!)))
      expect(files[`factory/${path}`]).toBe(text);
  });
});

describe("environments that are the same", () => {
  it("make no parameters", () => {
    const models = resolveAll(
      { ...base, "project.yaml": erpProject(["  test: {}", "  acceptance: {}"]) },
      ["test", "acceptance"],
    );
    expect(jsonOf(fold(models).files, "factory/arm-template-parameters-definition.json")).toEqual(
      {},
    );
  });
});

describe("triggers", () => {
  it("stay stopped outside prod and production, whatever the environment's mode", () => {
    const models = resolveAll(
      { ...base, "project.yaml": erpProject(["  dev: {}", "  test: {}", "  prod: {}"]) },
      ["dev", "test", "prod"],
    );
    expect(models.test!.platform.mode).toBe("production");
    const files = fold(models).files;
    const state = (target: string) =>
      parametersOf(files, target).tr_erp_erp_properties_runtimeState;
    expect([state("dev"), state("test"), state("prod")]).toEqual(["Stopped", "Stopped", "Started"]);
  });
});

describe("a linked runtime", () => {
  it("links each environment to its own shared runtime, as a parameter", () => {
    const models = resolveAll(linkedRuntime(), ["dev", "prod"]);
    const files = fold(models).files;
    const name = "shir-erp_properties_typeProperties_linkedInfo_resourceId";
    expect(parametersOf(files, "dev")[name]).toBe(sharedRuntime(1));
    expect(parametersOf(files, "prod")[name]).toBe(sharedRuntime(2));
    expect(foldFailures(models)).toEqual([]);
  });
});
