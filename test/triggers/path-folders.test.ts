// A path token's expression is never split at its own slashes; an object's slash still splits;
// and the window parameters a token reads are declared.
import { describe, expect, it } from "vitest";
import { landedFile, landedLocation } from "../../src/design/layout.js";
import { json, landing } from "../erp.js";
import { tableProject } from "../table-project.js";
import { errors, perFlow } from "./flows.js";
import { credits, declared, flowB, sink, wrapped } from "./path-flows.js";
import { build, secondFlow } from "./projects.js";

describe("the token's slashes are never read as the folder's", () => {
  const region = `@{${wrapped("region")}}`;
  const day = "@{formatDateTime(pipeline().parameters.day, 'yyyy-MM-dd')}";

  it("keeps a string token in the file name whole", () => {
    const { result, files } = flowB("{object}/{run}_{parameters.region}.parquet");
    expect(errors(result)).toEqual([]);
    expect(sink(files)).toEqual({
      folder: "erp/erp.dbo.Credits",
      file: `@{pipeline().RunId}_${region}.parquet`,
    });
  });

  it("keeps a token in a nested folder whole", () => {
    const { result, files } = flowB("{object}/{parameters.region}/{parameters.day}/{run}.parquet");
    expect(errors(result)).toEqual([]);
    expect(sink(files)).toEqual({
      folder: `erp/erp.dbo.Credits/${region}/${day}`,
      file: "@{pipeline().RunId}.parquet",
    });
  });

  it("keeps tokens in both the folder and the file name whole", () => {
    const { result, files } = flowB(
      "{object}/{parameters.region}/{parameters.region}_{run}.parquet",
    );
    expect(errors(result)).toEqual([]);
    expect(sink(files)).toEqual({
      folder: `erp/erp.dbo.Credits/${region}`,
      file: `${region}_@{pipeline().RunId}.parquet`,
    });
  });

  it("reports the location with a * for each, wherever the token is", () => {
    const { result } = flowB("{object}/{parameters.region}/{parameters.region}_{run}.parquet");
    expect(landedLocation(credits(result), "parquet")).toBe(
      `${landing}/erp.dbo.Credits/*/*_*.parquet`,
    );
  });
});

describe("the window parameters a token or audit value reads", () => {
  const names = (files: Record<string, string>, file: string) =>
    Object.keys(json(files, file).properties.parameters);

  it("are declared by the pipeline that renders them (copy)", () => {
    const { result, files } = flowB(
      "{object}/{parameters.windowStart}_{parameters.windowEnd}.parquet",
      ["_end: run.parameters.windowEnd"],
    );
    expect(errors(result)).toEqual([]);
    expect(names(files, "pipeline/pl_erp_erp_b.json")).toEqual(
      expect.arrayContaining(["windowStart", "windowEnd"]),
    );
  });

  it("are declared by the pipeline that renders them (table)", () => {
    const ingest = `${declared}\n  with:\n    path: "{object}/{parameters.windowStart}.parquet"\n`;
    const salesforce = tableProject(
      "salesforce",
      "  url: https://synthetic.my.salesforce.com\n  client_id: synthetic-client\n  client_secret: ${secret:salesforce-client}\n  api_version: '60.0'",
      "Account",
    );
    const built = build({
      ...salesforce,
      "standard.yaml": `${salesforce["standard.yaml"]}operations:\n  schedule: { per: flow }\n`,
      "flow-b.yaml": secondFlow(ingest).replace("erp.dbo.Credits", "Contact"),
    });
    expect(errors(built.result)).toEqual([]);
    expect(names(built.files, "pipeline/pl_erp_erp_b.json")).toEqual(
      expect.arrayContaining(["windowStart", "windowEnd", "region"]),
    );
  });

  it("are refused for a path under pattern: foreach, whose pipeline reads them per item", () => {
    const standard = perFlow().replace("adf-copy:", "adf-copy:\n      pattern: foreach");
    const ingest = `${declared}\n  with:\n    path: "{object}/{parameters.windowStart}.parquet"\n`;
    const built = build({ "standard.yaml": standard, "flow-b.yaml": secondFlow(ingest) });
    expect(errors(built.result).join("\n")).toContain("use pattern: activities");
  });
});

describe("an object name with a / still splits the folder, as it always did", () => {
  const { result } = flowB("{object}/{run}.parquet");
  const landed = (path: string) => {
    const table = credits(result);
    const ingest = {
      ...table.ingest!,
      object: "dir/file",
      settings: { ...table.ingest!.settings, path },
    };
    return landedFile({ ...table, ingest }, "parquet");
  };

  it("splits at the object's / for a path with static tokens", () => {
    expect(landed("{connection}/{object}.parquet")).toEqual({
      folder: "erp/erp/dir",
      file: "file.parquet",
    });
  });

  it("splits at the object's / and keeps a parameter whole", () => {
    expect(landed("{object}_{parameters.region}.parquet")).toEqual({
      folder: "erp/dir",
      file: `file_@{${wrapped("region")}}.parquet`,
    });
  });
});
