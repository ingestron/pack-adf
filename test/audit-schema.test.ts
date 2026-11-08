// The schema of an audit column's value is one of the pack's values or other text. It must
// accept and refuse exactly what the plain text schema it replaced did, so the same project
// is resolved with the pack and with a copy of it that has the earlier schema.
import { memoryFiles } from "@ingestron/config";
import { resolveDefinitions, type Pack } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { auditValues } from "../src/design/design-settings.js";
import { adf } from "../src/index.js";
import { base } from "./erp.js";
import { store } from "./store-pack.js";

const earlier = { type: "string", minLength: 1 };

/** The pack with the audit column value schema it had before. */
function withEarlierSchema(): Pack {
  const method = adf.methods["adf-copy"]!;
  const settings = method.settings as { properties: Record<string, Record<string, unknown>> };
  return {
    ...adf,
    methods: {
      ...adf.methods,
      "adf-copy": {
        ...method,
        settings: {
          ...settings,
          properties: {
            ...settings.properties,
            audit_columns: { ...settings.properties.audit_columns, additionalProperties: earlier },
          },
        },
      },
    },
  } as Pack;
}

/** The codes of the errors of a project whose audit column holds this YAML value, each once. */
function errors(pack: Pack, value: string): string[] {
  const standard = base["standard.yaml"]!.replace(
    "      start: 2026-10-01T00:00:00Z\n",
    `      start: 2026-10-01T00:00:00Z\n      audit_columns: { _a: ${value} }\n`,
  );
  const result = resolveDefinitions(memoryFiles({ ...base, "standard.yaml": standard }), {
    packs: [store, pack],
    environment: "dev",
  });
  const codes = result.diagnostics
    .filter((item) => item.severity === "error")
    .map((item) => item.code);
  return [...new Set(codes)];
}

/** YAML values: the pack's values, other cases and text, and what is not text. */
const accepted = [
  ...Object.keys(auditValues),
  "RUN.ID",
  "Source.Object",
  "'${environment.name}'",
  "x",
  "' '",
];
const refused = [
  "''",
  "0",
  "1",
  "1.5",
  "true",
  "false",
  "null",
  "[]",
  "[run.id]",
  "{}",
  "{ id: run.id }",
];

describe("the audit column value schema", () => {
  const earlierPack = withEarlierSchema();

  it("really has the earlier schema in the copy, and the new one in the pack", () => {
    expect(JSON.stringify(adf.methods["adf-copy"]!.settings)).toContain('"anyOf"');
    expect(JSON.stringify(earlierPack.methods["adf-copy"]!.settings)).not.toContain('"anyOf"');
  });

  it.each([...accepted, ...refused, "run.started"])(
    "treats %s as the earlier schema did",
    (value) => {
      expect(errors(adf, value)).toEqual(errors(earlierPack, value));
    },
  );

  it.each(accepted)("accepts %s", (value) => {
    expect(errors(adf, value)).toEqual([]);
  });

  it.each(refused)("refuses %s", (value) => {
    expect(errors(adf, value)).not.toEqual([]);
  });
});
