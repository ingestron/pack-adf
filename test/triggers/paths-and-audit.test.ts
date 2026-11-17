// A `{parameters.<name>}` token in a landing path, and `run.parameters.<name>` audit values: both
// read a parameter the flow declares (or a built-in), and render it by its type.
import { describe, expect, it } from "vitest";
import { landedFile, landedLocation, pathProblems } from "../../src/design/layout.js";
import { json, landing } from "../erp.js";
import { errors, perFlow } from "./flows.js";
import { credits, declared, flowB, sink, wrapped } from "./path-flows.js";
import { build, secondFlow } from "./projects.js";

describe("the {parameters.<name>} path token", () => {
  const { result, files } = flowB("{object}/{parameters.region}/{run}.parquet");

  it("renders a string parameter into the sink path, unable to leave the folder", () => {
    expect(errors(result)).toEqual([]);
    expect(sink(files).folder).toBe(`erp/erp.dbo.Credits/@{${wrapped("region")}}`);
    expect(sink(files).file).toBe("@{pipeline().RunId}.parquet");
  });

  it("lands in the location pattern as a *", () => {
    const table = credits(result);
    expect(landedLocation(table, "parquet")).toBe(`${landing}/erp.dbo.Credits/*/*.parquet`);
    expect(landedFile(table, "parquet").folder).toContain("@{replace(");
  });

  it.each([
    ["day", "@{formatDateTime(pipeline().parameters.day, 'yyyy-MM-dd')}"],
    ["at", "@{formatDateTime(pipeline().parameters.at, 'yyyy-MM-ddTHHmmss')}"],
    ["batch", "@{string(pipeline().parameters.batch)}"],
    ["ratio", "@{string(pipeline().parameters.ratio)}"],
    ["full", "@{string(pipeline().parameters.full)}"],
    ["windowStart", "@{formatDateTime(pipeline().parameters.windowStart, 'yyyy-MM-ddTHHmmss')}"],
    ["windowEnd", "@{formatDateTime(pipeline().parameters.windowEnd, 'yyyy-MM-ddTHHmmss')}"],
    ["load", `@{${wrapped("load")}}`],
  ])("renders %s by its type", (name, expression) => {
    const built = flowB(`{object}/{parameters.${name}}/{run}.parquet`);
    expect(errors(built.result)).toEqual([]);
    expect(sink(built.files).folder).toBe(`erp/erp.dbo.Credits/${expression}`);
  });

  it("is refused for a name the flow does not declare", () => {
    const built = flowB("{object}/{parameters.nope}/{run}.parquet");
    expect(errors(built.result).join("\n")).toContain(
      "{parameters.nope} names no parameter of the flow.",
    );
    expect(pathProblems("{object}/{parameters.a}/{run}.parquet", "parquet", [])).toEqual([
      "{parameters.a} names no parameter of the flow.",
    ]);
    expect(pathProblems("{object}/{parameters.a}/{run}.parquet", "parquet", ["a"])).toEqual([]);
  });

  it("refuses load when no trigger sets it, because the pipeline does not declare it", () => {
    const ingest = `${declared}\n  with:\n    path: "{object}/{parameters.load}/{run}.parquet"\n`;
    const built = build({ "standard.yaml": perFlow(), "flow-b.yaml": secondFlow(ingest) });
    expect(errors(built.result).join("\n")).toContain("{parameters.load} names no parameter");
  });

  it("is refused under pattern: foreach, like the other tokens", () => {
    const standard = perFlow().replace("adf-copy:", "adf-copy:\n      pattern: foreach");
    const ingest = `${declared}\n  with:\n    path: "{object}/{parameters.region}/{run}.parquet"\n`;
    const built = build({ "standard.yaml": standard, "flow-b.yaml": secondFlow(ingest) });
    expect(errors(built.result).join("\n")).toContain("use pattern: activities");
  });

  it("changes nothing for a project that does not use it", () => {
    const plain = build({}).files["pipeline/pl_erp_erp.json"];
    expect(plain).not.toContain("parameters.region");
  });
});

describe("run.parameters.<name> audit values", () => {
  const audit = [
    "_region: run.parameters.region",
    "_at: Run.Parameters.at",
    "_start: run.parameters.windowStart",
  ];
  const { result, files } = flowB("{object}/{run}.parquet", audit);

  it("maps to the pipeline's parameter, as an expression", () => {
    expect(errors(result)).toEqual([]);
    const source = json(files, "pipeline/pl_erp_erp_b.json").properties.activities[0].typeProperties
      .source;
    expect(source.additionalColumns).toEqual([
      { name: "_region", value: { value: "@pipeline().parameters.region", type: "Expression" } },
      { name: "_at", value: { value: "@pipeline().parameters.at", type: "Expression" } },
      {
        name: "_start",
        value: { value: "@pipeline().parameters.windowStart", type: "Expression" },
      },
    ]);
  });

  it("is a string column in the landed output", () => {
    const columns = (
      credits(result).ingest!.output as { columns: { name: string; logicalType: string }[] }
    ).columns;
    expect(columns.map((column) => [column.name, column.logicalType])).toEqual([
      ["_region", "string"],
      ["_at", "string"],
      ["_start", "string"],
    ]);
  });

  it("is a problem naming the column when the flow declares no such parameter", () => {
    const built = flowB("{object}/{run}.parquet", ["_x: run.parameters.nope"]);
    expect(errors(built.result).join("\n")).toContain(
      'audit column "_x" uses "run.parameters.nope", which names no parameter of the flow',
    );
  });

  it("is a problem when the name is not a parameter name", () => {
    const built = flowB("{object}/{run}.parquet", ["_x: run.parameters.a-b"]);
    expect(errors(built.result).join("\n")).toContain(
      'audit column "_x" uses "run.parameters.a-b"',
    );
  });
});
