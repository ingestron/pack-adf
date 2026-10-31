// Where ADF lands each table's files: the layout, path patterns and their problems.
import type { ResolvedModel, ResolvedTable } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { landedFile, landedLocation, layoutOf, pathProblems, replacesFile } from "../src/layout.js";
import { base, generate, landing } from "./erp.js";

const landingOnly = base["standard.yaml"]!.replace(
  "packs: [store@1, adf@1]",
  "packs: [adf@1]\nstore: { default: none }",
);

/** The invoices table, resolved with the standard changed by `edit`. */
function invoices(standard = base["standard.yaml"]!, settings = ""): ResolvedTable {
  const text = standard.replace(
    "      start: 2026-10-01T00:00:00Z\n",
    `      start: 2026-10-01T00:00:00Z\n${settings}`,
  );
  const { result } = generate({ "standard.yaml": text });
  expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return (result.model as ResolvedModel).tables[0]!;
}

const pattern = "{object}/{yyyy}/{MM}/{object}_{run}.parquet";
const window = (part: string) => `@{formatDateTime(pipeline().parameters.windowStart, '${part}')}`;

describe("layoutOf", () => {
  it("lands one file per table when the flow ends at the files", () => {
    expect(layoutOf(invoices(landingOnly))).toBe("snapshot");
  });

  it("keeps a file per run when a store reads the files", () => {
    expect(layoutOf(invoices())).toBe("increments");
  });

  it("follows the layout the standard sets", () => {
    expect(layoutOf(invoices(landingOnly, "      layout: increments\n"))).toBe("increments");
  });

  it("uses the path pattern when one is set", () => {
    expect(layoutOf(invoices(landingOnly, `      path: "${pattern}"\n`))).toBe("path");
  });
});

describe("landedFile", () => {
  it("names the snapshot after the object", () => {
    expect(landedFile(invoices(landingOnly), "parquet")).toEqual({
      folder: "erp/erp.dbo.Invoices",
      file: "erp.dbo.Invoices.parquet",
    });
  });

  it("keeps today's file name for increments", () => {
    expect(landedFile(invoices(), "parquet")).toEqual({
      folder: "erp/erp.dbo.Invoices",
      file: "@{concat(formatDateTime(pipeline().parameters.windowStart, 'yyyyMMddHHmmss'), '_', pipeline().RunId, '.parquet')}",
    });
  });

  it("turns a path pattern's tokens into ADF expressions", () => {
    expect(landedFile(invoices(landingOnly, `      path: "${pattern}"\n`), "parquet")).toEqual({
      folder: `erp/erp.dbo.Invoices/${window("yyyy")}/${window("MM")}`,
      file: "erp.dbo.Invoices_@{pipeline().RunId}.parquet",
    });
  });
});

describe("landedLocation", () => {
  it("is the snapshot file", () => {
    expect(landedLocation(invoices(landingOnly), "parquet")).toBe(
      `${landing}/erp.dbo.Invoices/erp.dbo.Invoices.parquet`,
    );
  });

  it("matches every increment", () => {
    expect(landedLocation(invoices(), "parquet")).toBe(`${landing}/erp.dbo.Invoices/*.parquet`);
  });

  it("puts a wildcard for each date or run token", () => {
    expect(landedLocation(invoices(landingOnly, `      path: "${pattern}"\n`), "parquet")).toBe(
      `${landing}/erp.dbo.Invoices/*/*/erp.dbo.Invoices_*.parquet`,
    );
  });
});

describe("replacesFile", () => {
  it("is true for a snapshot or a path without date or run tokens", () => {
    expect(replacesFile(invoices(landingOnly))).toBe(true);
    expect(replacesFile(invoices(landingOnly, '      path: "{object}/latest.parquet"\n'))).toBe(
      true,
    );
  });

  it("is false when each run adds a file", () => {
    expect(replacesFile(invoices())).toBe(false);
    expect(replacesFile(invoices(landingOnly, `      path: "${pattern}"\n`))).toBe(false);
  });
});

describe("pathProblems", () => {
  it("accepts a pattern with known tokens and the format's extension", () => {
    expect(pathProblems(pattern, "parquet")).toEqual([]);
  });

  it("needs a file name", () => {
    expect(pathProblems("{object}/", "parquet")).toEqual([
      'the path pattern "{object}/" must end in a file name',
    ]);
  });

  it("names an unknown token and the tokens it knows", () => {
    expect(pathProblems("{table}.parquet", "parquet")).toEqual([
      'the path pattern "{table}.parquet" uses an unknown token {table}; tokens: object, connection, yyyy, MM, dd, HH, run',
    ]);
  });

  it("needs the format's extension", () => {
    expect(pathProblems("{object}.csv", "parquet")).toEqual([
      'the path pattern "{object}.csv" must end in .parquet',
    ]);
  });
});
