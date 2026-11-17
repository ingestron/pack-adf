// A filter with quotes of its own, and a number in it, in each form the query is built: the load
// switch's concat, the ForEach's run-time expression, and the plain copy.
import { describe, expect, it } from "vitest";
import { generate, json } from "../erp.js";
import { errors, perFlow } from "./flows.js";

const filter = "status = 'A' AND k = {{ parameters.p }}";
const trigger =
  '  triggers:\n    - { name: t, type: schedule, every: { frequency: Hour, interval: 1 }, start: "2026-12-01T00:00:00Z", lookback: 2h, parameters: { load: incremental } }\n';
const flow = (text: string, type = "string") =>
  "apiVersion: ingestron.io/v1\nkind: Flow\nid: b\nsource: erp\ningest:\n" +
  `  parameters:\n    p: { type: ${type}, default: ${type === "string" ? "a" : "1"} }\n${trigger}` +
  `tables:\n  credits: { object: erp.dbo.Credits, contract: invoices, ingest: { filter: "${text}" } }\n`;
const standard = (pattern = "") =>
  perFlow()
    .replace(
      "      start: 2026-10-01T00:00:00Z\n",
      "      mode: incremental\n      watermark_column: modified_at\n      start: 2026-10-01T00:00:00Z\n",
    )
    .replace("adf-copy:", `adf-copy:${pattern}`);

function pipeline(text: string, pattern?: string, type?: string) {
  const { result, files } = generate({
    "standard.yaml": standard(pattern),
    "flow-b.yaml": flow(text, type),
  });
  expect(errors(result)).toEqual([]);
  return json(files, "pipeline/pl_erp_erp_b.json").properties.activities[0];
}

const select = "SELECT\n  [invoice_id],\n  [amount],\n  [modified_at]\nFROM [dbo].[Credits]";
const escaped = "replace(pipeline().parameters.p, '''', '''''')";
const at = (name: string) => `formatDateTime(pipeline().parameters.${name}, 'yyyy-MM-dd HH:mm:ss')`;

describe("the load switch with a filter", () => {
  it("narrows both branches, keeping the filter's own quotes", () => {
    const query = pipeline(filter).typeProperties.source.sqlReaderQuery;
    expect(query).toEqual({
      type: "Expression",
      value:
        `${select}@{if(equals(pipeline().parameters.load,'full'), ` +
        `concat('\nWHERE (status = ''A'' AND k = ''', ${escaped}, '''\n)'), ` +
        `concat('\nWHERE ([modified_at] >= ''', ${at("windowStart")}, ` +
        `'''\n  AND [modified_at] < ''', ${at("windowEnd")}, ''')\n  AND (status = ''A'' AND k = ''', ` +
        `${escaped}, '''\n)'))}`,
    });
  });

  it("parenthesises a number so a negative value cannot form a comment", () => {
    const { value } = pipeline("k = {{ parameters.p }}", undefined, "int").typeProperties.source
      .sqlReaderQuery;
    expect(value).toContain(
      "concat('\nWHERE (k = (', string(int(pipeline().parameters.p)), ')\n)')",
    );
  });
});

describe("the ForEach pattern with a filter", () => {
  it("builds the filter's own quotes and the escaped value at run time", () => {
    const loop = pipeline(filter, "\n      pattern: foreach").typeProperties.activities[0];
    const text = loop.typeProperties.source.sqlReaderQuery.value as string;
    expect(text).toContain(`concat('status = ''A'' AND k = ''', ${escaped}, '''')`);
    expect(text).not.toContain("@{pipeline().parameters.p}");
  });
});
