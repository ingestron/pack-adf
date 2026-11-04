// The fold property catches a fold that changes what an environment gets: each
// deliberately wrong factory below fails checkFold.
import { checkFold, type Pack } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { adf } from "../src/index.js";
import { armFold, erpEnvironments, resolveAll } from "./fold-helpers.js";

const models = resolveAll(erpEnvironments(), ["dev", "test", "prod"]);
const view = armFold(models);

// Parsed JSON is untyped; the changes only set and delete keys.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

/** The pack, with one folded file changed by `change`. */
function wrong(path: string, change: (data: Json) => void): Pack {
  return {
    ...adf,
    buildEnvironments(targets) {
      const built = adf.buildEnvironments!(targets);
      if (!built.files[path]) return built;
      const data = JSON.parse(built.files[path]!) as Json;
      change(data);
      return { ...built, files: { ...built.files, [path]: JSON.stringify(data) } };
    },
  };
}

describe("the fold property", () => {
  it("holds for the pack's own fold of one, two and three environments", () => {
    expect(checkFold(adf, models, view)).toEqual([]);
  });

  it("fails when an environment's parameter file has another environment's value", () => {
    const pack = wrong("parameters/prod.json", (file) => {
      file.parameters.ls_erp_landing_properties_typeProperties_url.value =
        "https://erplakedev.dfs.core.windows.net";
    });
    expect(checkFold(pack, models, view)).toContain(
      "With dev, test, prod, for prod: linkedService/ls_erp_landing.json differs from the render.",
    );
  });

  it("fails when the definition leaves out a value that differs", () => {
    const pack = wrong("factory/arm-template-parameters-definition.json", (definition) => {
      delete definition["Microsoft.DataFactory/factories/triggers"];
    });
    expect(checkFold(pack, models, view)).toContain(
      "With dev, test, prod, for prod: trigger/tr_erp_every_24_hour.json differs from the render.",
    );
  });

  it("fails when a parameter file leaves out a value it should set", () => {
    const pack = wrong("parameters/test.json", (file) => {
      delete file.parameters.ls_erp_keyvault_properties_typeProperties_baseUrl;
    });
    expect(checkFold(pack, models, view)).toContain(
      "With dev, test, prod, for test: linkedService/ls_erp_keyvault.json differs from the render.",
    );
  });
});
