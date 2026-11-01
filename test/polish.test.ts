// Landing paths ADF would misread, a flow's path over a standard's layout,
// and after_copy's names, IDs and timeouts.
import { describe, expect, it } from "vitest";
import { pathProblems } from "../src/layout.js";
import { base, generate, json } from "./erp.js";

const errors = (changes: Record<string, string>) =>
  generate(changes)
    .result.diagnostics.filter((item) => item.severity === "error")
    .map(({ message }) => message);

describe("path patterns ADF would misread", () => {
  it.each([
    [
      "/{object}/{object}.parquet",
      'the path pattern "/{object}/{object}.parquet" must not start with /',
    ],
    [
      "{object}//{object}.parquet",
      'the path pattern "{object}//{object}.parquet" has an empty folder name',
    ],
    [
      "{object}/../{object}.parquet",
      'the path pattern "{object}/../{object}.parquet" must not use . or .. as a folder',
    ],
    [
      "{object}/x}.parquet",
      'the path pattern "{object}/x}.parquet" has a brace that is not part of a {token}',
    ],
    [
      "@{object}/{object}.parquet",
      'the path pattern "@{object}/{object}.parquet" has a name starting with @, which ADF reads as an expression',
    ],
  ])("refuses %s", (path, message) => {
    expect(pathProblems(path, "parquet")).toContain(message);
  });

  it("refuses an object starting with @", () => {
    const flow = base["flow.yaml"]!.replace("erp.dbo.Invoices", '"@erp.dbo.Invoices"');
    expect(errors({ "flow.yaml": flow }).join("\n")).toContain(
      'the object "@erp.dbo.Invoices" has a name starting with @, which ADF reads as an expression',
    );
  });
});

describe("a flow's path and a standard's layout", () => {
  it("uses the flow's path over the standard's layout", () => {
    const standard = base["standard.yaml"]!.replace(
      "      start: 2026-10-01T00:00:00Z\n",
      "      start: 2026-10-01T00:00:00Z\n      layout: increments\n",
    );
    const flow = base["flow.yaml"]!.replace(
      "source: erp\n",
      'source: erp\ningest: { with: { path: "{object}/{yyyy}/{object}_{run}.parquet" } }\n',
    );
    expect(errors({ "standard.yaml": standard, "flow.yaml": flow })).toEqual([]);
    const copy = json(
      generate({ "standard.yaml": standard, "flow.yaml": flow }).files,
      "pipeline/pl_erp_erp.json",
    ).properties.activities[0];
    expect(copy.outputs[0].parameters.file).toBe("erp.dbo.Invoices_@{pipeline().RunId}.parquet");
  });
});

describe("layout and path across layers", () => {
  it("still finds two tables landing at the same file when their layout wins over a path", () => {
    const standard = base["standard.yaml"]!.replace(
      "      start: 2026-10-01T00:00:00Z\n",
      '      start: 2026-10-01T00:00:00Z\n      path: "{object}/{yyyy}/{object}_{run}.parquet"\n',
    );
    const second =
      "apiVersion: ingestron.io/v1\nkind: Flow\nid: again\nsource: erp\ningest: { with: { layout: snapshot } }\ntables:\n  again: { object: erp.dbo.Invoices, contract: invoices }\n";
    const flow = base["flow.yaml"]!.replace(
      "source: erp\n",
      "source: erp\ningest: { with: { layout: snapshot } }\n",
    );
    expect(
      errors({ "standard.yaml": standard, "flow.yaml": flow, "again.yaml": second }).join("\n"),
    ).toMatch(/overlap|land at the same files/);
  });

  it("refuses a flow's path when the standard fixes layout", () => {
    const standard = base["standard.yaml"]!.replace(
      "ingest:\n",
      "ingest:\n  fixed:\n    adf-copy: { layout: snapshot }\n",
    );
    const flow = base["flow.yaml"]!.replace(
      "source: erp\n",
      'source: erp\ningest: { with: { path: "{object}/{yyyy}/{object}_{run}.parquet" } }\n',
    );
    expect(errors({ "standard.yaml": standard, "flow.yaml": flow }).join("\n")).toContain(
      "the standard fixes layout, so path cannot be set; remove path",
    );
  });
});
