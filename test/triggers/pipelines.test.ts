// A flow that writes triggers or parameters has a pipeline of its own, which declares its
// parameters; every project that writes neither generates what it always did.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { base, json } from "../erp.js";
import { addResource } from "../../src/factory/index.js";
import { onceFor } from "../../src/output/groups.js";
import { build, projects, secondFlow } from "./projects.js";

const golden = JSON.parse(
  readFileSync(new URL("./golden.json", import.meta.url), "utf8"),
) as Record<string, Record<string, string>>;

const parameters =
  "  parameters:\n    min_date: { type: date, default: '2020-01-01' }\n    batch: { type: int, default: 5 }\n";
const trigger =
  '  triggers:\n    - { name: daily, type: schedule, every: { frequency: Day, interval: 1 }, start: "2026-12-01T00:00:00Z" }\n';
const standard = (pattern = "") =>
  base["standard.yaml"]!.replace("adf-copy:", `adf-copy:${pattern}`) +
  "operations:\n  schedule: { per: flow }\n";

/** The ERP flow plus flow `b` with this ingest part, under a standard where flows write triggers. */
function twoFlows(ingest: string, pattern = "") {
  const built = build({
    "standard.yaml": standard(pattern),
    "flow-b.yaml": secondFlow(ingest),
  });
  expect(built.result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return built.files;
}

describe("projects whose flows write neither triggers nor parameters", () => {
  for (const [name, changes] of Object.entries(projects))
    it(`generate the same files for ${name}`, () => {
      expect(build(changes).files).toEqual(golden[name]);
    });

  it("keeps one pipeline for two flows on a connection", () => {
    const files = build({ "flow-b.yaml": secondFlow("  with: {}") }).files;
    expect(Object.keys(files).filter((path) => path.startsWith("pipeline/"))).toEqual([
      "pipeline/pl_erp_erp.json",
    ]);
  });
});

describe("a flow that writes triggers and parameters", () => {
  it("has a pipeline of its own beside the connection's", () => {
    const files = twoFlows(parameters + trigger);
    expect(
      Object.keys(files)
        .filter((path) => path.startsWith("pipeline/"))
        .sort(),
    ).toEqual(["pipeline/pl_erp_erp.json", "pipeline/pl_erp_erp_b.json"]);
    expect(files["pipeline/pl_erp_erp.json"]).toBe(golden.copy!["pipeline/pl_erp_erp.json"]);
    const own = json(files, "pipeline/pl_erp_erp_b.json");
    expect(own.properties.parameters).toEqual({
      windowStart: { type: "string" },
      windowEnd: { type: "string" },
      min_date: { type: "String", defaultValue: "2020-01-01" },
      batch: { type: "Int", defaultValue: 5 },
    });
    expect(own.properties.activities.map((item: { name: string }) => item.name)).toEqual([
      "copy_credits",
    ]);
  });

  it("shares the connection's linked service and dataset, and runs from a trigger of its own", () => {
    const files = twoFlows(parameters);
    expect(files["linkedService/ls_erp_erp_erp.json"]).toBe(
      golden.copy!["linkedService/ls_erp_erp_erp.json"],
    );
    expect(files["dataset/ds_erp_erp_erp.json"]).toBe(golden.copy!["dataset/ds_erp_erp_erp.json"]);
    const own = json(files, "trigger/tr_erp_erp_b.json");
    expect(own.properties.pipeline.pipelineReference.referenceName).toBe("pl_erp_erp_b");
    expect(files["trigger/tr_erp_erp.json"]).toBe(golden.copy!["trigger/tr_erp_erp.json"]);
  });

  it("declares load, defaulting to the table's load mode, when a trigger sets it", () => {
    const loads = trigger.replace("}\n", ", parameters: { load: full } }\n");
    const own = json(twoFlows(loads), "pipeline/pl_erp_erp_b.json").properties.parameters;
    expect(own.load).toEqual({ type: "String", defaultValue: "full" });
    expect(own.min_date).toBeUndefined();
    expect(
      json(twoFlows(parameters + trigger), "pipeline/pl_erp_erp_b.json").properties.parameters,
    ).not.toHaveProperty("load");
  });

  it("types the parameters as ADF does", () => {
    const all = [
      "s: { type: string, default: a }",
      "d: { type: date, default: '2020-01-01' }",
      "t: { type: datetime, default: '2020-01-01T00:00:00Z' }",
      "i: { type: int, default: 1 }",
      "f: { type: float, default: 1.5 }",
      "b: { type: bool, default: true }",
    ];
    const text = `  parameters:\n${all.map((line) => `    ${line}`).join("\n")}\n`;
    const declared = json(twoFlows(text), "pipeline/pl_erp_erp_b.json").properties.parameters;
    const types = Object.fromEntries(
      Object.entries(declared as Record<string, { type: string }>).map(([k, v]) => [k, v.type]),
    );
    expect(types).toEqual({
      windowStart: "string",
      windowEnd: "string",
      s: "String",
      d: "String",
      t: "String",
      i: "Int",
      f: "Float",
      b: "Bool",
    });
  });

  it("declares them in the foreach pipeline too, keeping the tables parameter", () => {
    const files = twoFlows(parameters, "\n      pattern: foreach");
    const own = json(files, "pipeline/pl_erp_erp_b.json").properties.parameters;
    expect(Object.keys(own)).toEqual(["windowStart", "windowEnd", "tables", "min_date", "batch"]);
    expect(own.tables.defaultValue.map((item: { table: string }) => item.table)).toEqual([
      "credits",
    ]);
  });
});

describe("the other methods", () => {
  it("gives a files flow and a native table flow a pipeline of their own", () => {
    for (const name of ["files", "table"] as const) {
      const flow = projects[name]!["flow.yaml"]!.replace(
        "tables:",
        `ingest:\n${parameters}tables:`,
      );
      const { result, files } = build({
        ...projects[name]!,
        "standard.yaml":
          projects[name]!["standard.yaml"]! + "operations:\n  schedule: { per: flow }\n",
        "flow.yaml": flow,
      });
      expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
      const own = json(files, "pipeline/pl_erp_erp_erp.json");
      expect(own.properties.parameters.min_date).toEqual({
        type: "String",
        defaultValue: "2020-01-01",
      });
      expect(files["trigger/tr_erp_erp_erp.json"]).toBeDefined();
    }
  });

  it("writes a shared linked service once when a second flow has its own pipeline", () => {
    for (const name of ["files", "table"] as const) {
      const { result, files } = build({
        ...projects[name]!,
        "standard.yaml":
          projects[name]!["standard.yaml"]! + "operations:\n  schedule: { per: flow }\n",
        "flow-b.yaml": secondFlow(parameters).replace("erp.dbo.Credits", "Contact"),
      });
      expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
      const kept = Object.keys(golden[name]!).filter((path) => !path.includes("trigger/"));
      for (const path of kept.filter((item) => !item.startsWith("pipeline/")))
        expect(files[path], path).toBe(golden[name]![path]);
      expect(files["pipeline/pl_erp_erp.json"]).toBe(golden[name]!["pipeline/pl_erp_erp.json"]);
      expect(files["pipeline/pl_erp_erp_b.json"]).toBeDefined();
    }
  });

  it("keeps a parameters-only flow's pipeline and shares the connection's resources", () => {
    const flow = base["flow.yaml"]!.replace("tables:", `ingest:\n${parameters}tables:`);
    const { files } = build({ "standard.yaml": standard(), "flow.yaml": flow });
    expect(Object.keys(files).filter((path) => path.startsWith("pipeline/"))).toEqual([
      "pipeline/pl_erp_erp_erp.json",
    ]);
    expect(files["linkedService/ls_erp_erp_erp.json"]).toBe(
      golden.copy!["linkedService/ls_erp_erp_erp.json"],
    );
    expect(
      json(files, "trigger/tr_erp_erp_erp.json").properties.pipeline.pipelineReference,
    ).toEqual({ referenceName: "pl_erp_erp_erp", type: "PipelineReference" });
  });
});

describe("flows on one connection that disagree about its linked service", () => {
  const other = `${trigger}  uses: adf-copy\n  with: { integration_runtime: shir-other }\n`;

  it("is refused in the usual words, not settled by the first flow", () => {
    const { result } = build({ "standard.yaml": standard(), "flow-b.yaml": secondFlow(other) });
    const messages = result.diagnostics.map((item) => item.message);
    expect(messages).toContain(
      "the adf-copy tables of erp.erp share one linked service, so integration_runtime, runtime_kind and encrypt must be the same; invoices differs from credits.",
    );
    expect(result.model).toBeUndefined();
  });

  it("writes a repeated resource once, and refuses one that differs", () => {
    const files: Record<string, string> = {};
    const add = (folder: string, resource: { name?: unknown; properties?: unknown }) =>
      addResource(files, folder, resource);
    const once = onceFor(new Map(), "erp", add);
    once("linkedService", { name: "ls", properties: { runtime: "a" } });
    once("linkedService", { name: "ls", properties: { runtime: "a" } });
    expect(Object.keys(files)).toEqual(["linkedService/ls.json"]);
    expect(() => once("linkedService", { name: "ls", properties: { runtime: "b" } })).toThrow(
      /generated more than once/,
    );
  });
});
