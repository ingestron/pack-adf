// A flow table's source filter: each `{{ parameters.<name> }}` becomes a typed, escaped piece of
// the query, whichever way the copy is built, because a run started by hand can pass any value.
import { describe, expect, it } from "vitest";
import type { ParameterDef } from "@ingestron/definitions";
import { adfCopy } from "../../src/methods/index.js";
import { renderFilter } from "../../src/design/query.js";
import { generate, json } from "../erp.js";
import { errors, perFlow } from "./flows.js";

const def = (type: ParameterDef["type"], value: ParameterDef["default"]) => ({
  type,
  default: value,
});
const one = (type: ParameterDef["type"], value: ParameterDef["default"] = "x") =>
  renderFilter("c = {{ parameters.p }}", { p: def(type, value) });

describe("renderFilter", () => {
  it("quotes a string and doubles its single quotes", () => {
    expect(
      renderFilter("d >= {{ parameters.min_date }}", { min_date: def("string", "2020-01-01") }),
    ).toBe("d >= '@{replace(pipeline().parameters.min_date, '''', '''''')}'");
  });

  it("renders the brief's example, a date, as a date", () => {
    expect(
      renderFilter("d >= {{ parameters.min_date }}", { min_date: def("date", "2020-01-01") }),
    ).toBe("d >= '@{formatDateTime(pipeline().parameters.min_date, 'yyyy-MM-dd')}'");
  });

  it("reads a date or datetime as one, so a value that is not fails the expression", () => {
    expect(one("date")).toBe("c = '@{formatDateTime(pipeline().parameters.p, 'yyyy-MM-dd')}'");
    expect(one("datetime")).toBe(
      "c = '@{formatDateTime(pipeline().parameters.p, 'yyyy-MM-dd HH:mm:ss')}'",
    );
  });

  it("converts numbers and booleans, which are never quoted", () => {
    expect(one("int", 1)).toBe("c = (@{int(pipeline().parameters.p)})");
    expect(one("float", 1.5)).toBe("c = (@{float(pipeline().parameters.p)})");
    expect(one("bool", true)).toBe("c = @{if(bool(pipeline().parameters.p), '1', '0')}");
  });

  it("renders the built-in parameters without declaring them", () => {
    const window = "formatDateTime(pipeline().parameters.windowStart, 'yyyy-MM-dd HH:mm:ss')";
    expect(renderFilter("a > {{parameters.windowStart}}", {})).toBe(`a > '@{${window}}'`);
    expect(renderFilter("{{ parameters.windowEnd }}", {})).toBe(
      "'@{formatDateTime(pipeline().parameters.windowEnd, 'yyyy-MM-dd HH:mm:ss')}'",
    );
    expect(renderFilter("{{ parameters.load }}", {})).toBe(
      "'@{replace(pipeline().parameters.load, '''', '''''')}'",
    );
  });

  it("keeps the filter's own text and never inserts a name it cannot type as raw text", () => {
    expect(renderFilter("name = 'a' AND k = {{ parameters.p }}", {})).toBe(
      "name = 'a' AND k = '@{replace(pipeline().parameters.p, '''', '''''')}'",
    );
  });
});

const flow = (filters: string, parameters = "p: { type: string, default: a }") =>
  "apiVersion: ingestron.io/v1\nkind: Flow\nid: b\nsource: erp\ningest:\n" +
  `  parameters:\n    ${parameters}\ntables:\n${filters}`;
const credits = (filter: string) =>
  `  credits: { object: erp.dbo.Credits, contract: invoices, ingest: { filter: "${filter}" } }\n`;
const incremental = (text: string) =>
  text.replace(
    "      start: 2026-10-01T00:00:00Z\n",
    "      mode: incremental\n      watermark_column: modified_at\n      start: 2026-10-01T00:00:00Z\n",
  );
const built = (flows: string, standard = perFlow()) =>
  generate({ "standard.yaml": standard, "flow-b.yaml": flows });
const sqlOf = (files: Record<string, string>) =>
  json(files, "pipeline/pl_erp_erp_b.json").properties.activities[0].typeProperties.source
    .sqlReaderQuery;
const select = "SELECT\n  [invoice_id],\n  [amount],\n  [modified_at]\nFROM [dbo].[Credits]";
const string = "'@{replace(pipeline().parameters.p, '''', '''''')}'";

describe("a filter in a copy per table", () => {
  it("narrows a full table", () => {
    const { result, files } = built(flow(credits("k = {{ parameters.p }}")));
    expect(errors(result)).toEqual([]);
    expect(sqlOf(files)).toEqual({
      type: "Expression",
      value: `${select}\nWHERE (k = ${string}\n)`,
    });
  });

  it("follows the window by AND", () => {
    const { files } = built(flow(credits("k = {{ parameters.p }}")), incremental(perFlow()));
    const window = "formatDateTime(pipeline().parameters.windowStart, 'yyyy-MM-dd HH:mm:ss')";
    const end = "formatDateTime(pipeline().parameters.windowEnd, 'yyyy-MM-dd HH:mm:ss')";
    expect(sqlOf(files).value).toBe(
      `${select}\nWHERE ([modified_at] >= '@{${window}}'\n  AND [modified_at] < '@{${end}}')\n  AND (k = ${string}\n)`,
    );
  });

  it("leaves a filter without parameters as plain text", () => {
    expect(sqlOf(built(flow(credits("k > 1"))).files)).toBe(`${select}\nWHERE (k > 1\n)`);
  });
});

describe("a filter in the ForEach pattern", () => {
  const foreach = perFlow().replace("adf-copy:", "adf-copy:\n      pattern: foreach");
  const query = (flows: string) => {
    const { result, files } = built(flows, foreach);
    expect(errors(result)).toEqual([]);
    return json(files, "pipeline/pl_erp_erp_b.json").properties.activities[0].typeProperties
      .activities[0].typeProperties.source.sqlReaderQuery.value as string;
  };

  it("builds the filter at run time with the string escaped", () => {
    const text = query(flow(credits("k = {{ parameters.p }}")));
    expect(text).toContain("replace(pipeline().parameters.p, '''', '''''')");
    expect(text).not.toContain("@{pipeline().parameters.p}");
    expect(text).toContain(
      "if(equals(item().table, 'credits'), concat(if(empty(item().watermark), ",
    );
  });

  it("gives each table its own filter, and a table without one none", () => {
    const both =
      credits("a = {{ parameters.p }}") +
      `  more: { object: erp.dbo.More, contract: invoices, ingest: { filter: "b = 1" } }\n  plain: { object: erp.dbo.Plain, contract: invoices }\n`;
    const text = query(flow(both));
    expect(text).toContain("equals(item().table, 'credits')");
    expect(text).toContain("equals(item().table, 'more')");
    expect(text).not.toContain("'plain'");
  });
});

describe("what the pack refuses", () => {
  const dated = (type: string, value: string, filter = "d >= {{ parameters.p }}") =>
    errors(built(flow(credits(filter), `p: { type: ${type}, default: '${value}' }`)).result);

  it("a date that is not on the calendar, by the parameter's name", () => {
    expect(dated("date", "2026-13-45")).toEqual([
      'The parameter "p" of the flow "b" is a date and its default is "2026-13-45", which is not a real date.',
    ]);
    expect(dated("date", "2026-02-30")).toHaveLength(1);
    expect(dated("datetime", "2026-02-03T24:00:00Z")).toHaveLength(1);
  });

  it("accepts real dates and times", () => {
    expect(dated("date", "2028-02-29")).toEqual([]);
    expect(dated("datetime", "2026-02-03T23:59:59Z")).toEqual([]);
  });

  it("a literal trigger value that is not a date", () => {
    const triggers =
      "  triggers:\n    - { name: t, type: schedule, every: { frequency: Day, interval: 1 }, start: '2026-12-01T00:00:00Z', parameters: { p: '2026-13-45' } }\n";
    const text = flow(
      credits("d >= {{ parameters.p }}"),
      "p: { type: date, default: '2020-01-01' }",
    ).replace("tables:", `${triggers}tables:`);
    expect(errors(built(text).result)).toEqual([
      'The parameter "p" of the flow "b" is a date and its value in the trigger "t" is "2026-13-45", which is not a real date.',
    ]);
  });

  it("a filter that reads load when no trigger sets it", () => {
    expect(dated("string", "a", "k = {{ parameters.load }}")).toEqual([
      'The filter of the table "credits" reads {{ parameters.load }}, which no trigger of its flow sets; set `load` in a trigger\'s parameters.',
    ]);
  });
});

describe("the adf-copy method", () => {
  it("filters source rows", () => {
    expect(adfCopy.filters).toBe(true);
  });
});
