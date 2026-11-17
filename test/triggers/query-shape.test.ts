// How a flow table's query is shaped for ADF: the select written once, a filter's closing
// parenthesis on a line of its own, and no expression longer than ADF allows.
import { describe, expect, it } from "vitest";
import { query } from "../../src/design/index.js";
import { expressionLimit } from "../../src/output/index.js";
import { generate, json } from "../erp.js";
import { errors, perFlow } from "./flows.js";

const trigger =
  '  triggers:\n    - { name: t, type: schedule, every: { frequency: Hour, interval: 1 }, start: "2026-12-01T00:00:00Z", lookback: 2h, parameters: { load: incremental } }\n';
const flow = (filters: string) =>
  "apiVersion: ingestron.io/v1\nkind: Flow\nid: b\nsource: erp\ningest:\n" +
  `  parameters:\n    p: { type: string, default: a }\n${trigger}tables:\n${filters}`;
const table = (name: string, filter: string) =>
  `  ${name.toLowerCase()}: { object: erp.dbo.${name}, contract: invoices, ingest: { filter: "${filter}" } }\n`;
const standard = (pattern = "") =>
  perFlow()
    .replace(
      "      start: 2026-10-01T00:00:00Z\n",
      "      mode: incremental\n      watermark_column: modified_at\n      start: 2026-10-01T00:00:00Z\n",
    )
    .replace("adf-copy:", `adf-copy:${pattern}`);
const build = (filters: string, pattern?: string) =>
  generate({ "standard.yaml": standard(pattern), "flow-b.yaml": flow(filters) });
const copy = (files: Record<string, string>) =>
  json(files, "pipeline/pl_erp_erp_b.json").properties.activities[0];

describe("a filter that ends in a line comment", () => {
  const commented = "k = {{ parameters.p }} -- recent";

  it("cannot comment out the closing parenthesis of the load switch's branches", () => {
    const { result, files } = build(table("Credits", commented));
    expect(errors(result)).toEqual([]);
    const { value } = copy(files).typeProperties.source.sqlReaderQuery;
    expect(value.match(/ -- recent\n\)/g)).toHaveLength(2);
    expect(value).not.toContain("-- recent)");
  });

  it("cannot comment it out in the ForEach pattern", () => {
    const { files } = build(table("Credits", commented), "\n      pattern: foreach");
    const text = copy(files).typeProperties.activities[0].typeProperties.source.sqlReaderQuery
      .value as string;
    expect(text).toContain("' -- recent'), '\n)')");
  });

  it("cannot comment it out in a plain query", () => {
    const plain = {
      contract: { columns: [{ name: "a" }] },
      ingest: { object: "erp.dbo.T", settings: { mode: "full" }, filter: "a = 1 -- recent" },
    };
    expect(query(plain as never)).toBe("SELECT\n  [a]\nFROM [dbo].[T]\nWHERE (a = 1 -- recent\n)");
  });
});

describe("the select of the load switch", () => {
  it("is written once, however many columns it has", () => {
    const columns = Array.from({ length: 300 }, (_, index) => ({ name: `column_${index}` }));
    const many = {
      contract: { columns },
      ingest: {
        object: "erp.dbo.T",
        settings: { mode: "incremental", watermark_column: "column_0" },
        triggers: [{ parameters: { load: "full" } }],
      },
    };
    const { value } = query(many as never) as { value: string };
    expect(value.split("[column_299]")).toHaveLength(2);
  });
});

describe("ADF's limit on an expression", () => {
  const long = (length: number) => `k = {{ parameters.p }} AND n IN (${"1, ".repeat(length)}1)`;

  it("is 8,192 characters", () => {
    expect(expressionLimit).toBe(8192);
  });

  it("refuses a table's query that is longer, naming the table and the length", () => {
    const { result } = build(table("Credits", long(3000)));
    const [message] = errors(result).filter((text) => text.startsWith("The query of"));
    const { files } = build(table("Credits", long(10)));
    const short = copy(files).typeProperties.source.sqlReaderQuery.value as string;
    const length = (short.length + 3 * 2990 * 2).toLocaleString("en-GB");
    expect(message).toBe(
      `The query of the table "credits" is an ADF expression of ${length} characters; ADF allows at most 8,192 characters in an expression. Shorten its filter, or copy fewer columns.`,
    );
  });

  it("refuses a ForEach's query that is longer, naming its tables", () => {
    const filters = table("Credits", long(1500)) + table("Refunds", long(1600));
    const found = errors(build(filters, "\n      pattern: foreach").result);
    expect(found.find((text) => text.startsWith("The query of"))).toMatch(
      /^The query of the tables "credits", "refunds" is an ADF expression of [\d,]+ characters; /,
    );
  });

  it("keeps a query within the limit", () => {
    expect(errors(build(table("Credits", long(100))).result)).toEqual([]);
  });
});
