// A project with only the ADF pack, ending its flows at the landed files.
import { memoryFiles } from "@ingestron/config";
import { resolveDefinitions } from "@ingestron/definitions";
import { expect, it } from "vitest";
import { adf } from "../src/index.js";
import { base, json } from "./erp.js";

it("resolves and builds a project with only the ADF pack", () => {
  const standard = base["standard.yaml"]!.replace(
    "packs: [store@1, adf@1]",
    "packs: [adf@1]\nstore: { default: none }",
  );
  const result = resolveDefinitions(memoryFiles({ ...base, "standard.yaml": standard }), {
    packs: [adf],
    environment: "dev",
  });
  expect(result.diagnostics).toEqual([]);
  const files = adf.build(result.model!);
  const copy = json(files, "pipeline/pl_erp_erp.json").properties.activities[0];
  expect(copy.outputs[0].parameters.file).toBe("erp.dbo.Invoices.parquet");
  expect(
    Object.keys(files).every((path) => /^(linkedService|dataset|pipeline|trigger)\//.test(path)),
  ).toBe(true);
});
