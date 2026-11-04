// Folds made wrong on purpose, through Microsoft's own export: the checks the real
// folds pass must fail on them, so they are shown to have teeth.
import { describe, expect, it } from "vitest";
import { exportFixtures, ownTemplate } from "./export-fixtures.js";
import { fold, parametersOf } from "./fold-helpers.js";
import { deployed, exportTemplate, exportTool, writeFolder } from "./microsoft-export.js";

const tool = await exportTool(process.env.INGESTRON_REQUIRE_ADF_EXPORT === "1");

describe.runIf(tool.bundle)(
  "Microsoft's export of a deliberately wrong fold",
  { timeout: 120_000 },
  () => {
    const models = exportFixtures["three environments"]!;
    const built = fold(models);
    const template = tool.bundle
      ? exportTemplate(tool.bundle, `${writeFolder(built.files)}/factory`)
      : {};
    const declared = new Set(
      Object.keys(template.parameters ?? {}).filter((name) => name !== "factoryName"),
    );
    const own = tool.bundle ? deployed(ownTemplate(tool.bundle, models, "prod"), {}) : [];
    const url = "ls_erp_landing_properties_typeProperties_url";

    it("fails both checks when prod's file renames a parameter", () => {
      const values = parametersOf(built.files, "prod");
      const renamed = Object.fromEntries(
        Object.entries(values).map(([name, value]) => [name === url ? `${url}2` : name, value]),
      );
      expect(new Set(Object.keys(renamed))).not.toEqual(declared);
      expect(deployed(template, renamed)).not.toEqual(own);
    });

    it("fails the deployment check when prod's file has dev's value", () => {
      const values = {
        ...parametersOf(built.files, "prod"),
        [url]: parametersOf(built.files, "dev")[url],
      };
      expect(new Set(Object.keys(values))).toEqual(declared);
      expect(deployed(template, values)).not.toEqual(own);
    });

    it("fails both checks when the definition file leaves out a property that differs", () => {
      const path = "factory/arm-template-parameters-definition.json";
      const definition = JSON.parse(built.files[path]!);
      const blob = definition["Microsoft.DataFactory/factories/linkedServices"].AzureBlobFS;
      expect(blob.properties.typeProperties.url).toBe("-");
      delete blob.properties.typeProperties.url;
      const files = { ...built.files, [path]: `${JSON.stringify(definition, null, "\t")}\n` };
      const wrong = exportTemplate(tool.bundle!, `${writeFolder(files)}/factory`);
      const values = parametersOf(built.files, "prod");
      const names = new Set(Object.keys(wrong.parameters).filter((name) => name !== "factoryName"));
      expect(names.has(url)).toBe(false);
      expect(new Set(Object.keys(values))).not.toEqual(names);
      expect(deployed(wrong, values)).not.toEqual(own);
    });
  },
);
