// The pack's settings describe themselves: the docs render these descriptions,
// ranges, values and defaults, so each must be there and agree with the schema
// the pack enforces.
import { methodReference, type FieldInfo } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { auditValues, defaultParallel, designSettings } from "../src/design-settings.js";
import { adf } from "../src/index.js";

type Schema = Record<string, unknown>;

/** The schema node at a setting's path, following properties and `*` into additionalProperties. */
function nodeAt(schema: Schema, path: string[]): Schema | undefined {
  let node: Schema | undefined = schema;
  for (const part of path) {
    const properties = node?.properties as Record<string, Schema> | undefined;
    node = part === "*" ? (node?.additionalProperties as Schema | undefined) : properties?.[part];
  }
  return node;
}

const methods = Object.keys(adf.methods);
const rows = (method: string): FieldInfo[] => methodReference(adf, method);

describe("ADF setting metadata", () => {
  it.each(methods)("%s describes every setting", (method) => {
    const missing = rows(method)
      .filter((field) => !field.description)
      .map((field) => field.path.join("."));
    expect(missing).toEqual([]);
  });

  it.each(methods)("%s gives each allowed value its meaning", (method) => {
    const fields = rows(method).filter((field) => (field.values?.length ?? 0) > 0);
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      const node = nodeAt(adf.methods[method]!.settings as Schema, field.path)!;
      const allowed = (node.enum ?? [node.const]) as unknown[];
      expect(
        field.values!.map((item) => item.value),
        field.path.join("."),
      ).toEqual(allowed);
      if (field.values!.length > 1)
        expect(
          field
            .values!.filter((item) => typeof item.value === "string" && !item.description)
            .map((item) => item.value),
          `${field.path.join(".")} values without a meaning`,
        ).toEqual([]);
    }
  });

  it.each(methods)("%s states each numeric range in the setting's description", (method) => {
    const ranged = rows(method).filter((field) => {
      const node = nodeAt(adf.methods[method]!.settings as Schema, field.path);
      return node?.maximum !== undefined && node.minimum !== undefined;
    });
    expect(ranged.map((field) => field.path.join("."))).toEqual(
      expect.arrayContaining(["parallel", "activity.retries", "activity.retry_interval"]),
    );
    for (const field of ranged) {
      const node = nodeAt(adf.methods[method]!.settings as Schema, field.path)!;
      expect(field.description, field.path.join(".")).toContain(
        `from ${String(node.minimum)} to ${String(node.maximum)}`,
      );
    }
  });

  it("gives the activity ranges ADF accepts", () => {
    const { properties } = designSettings.activity;
    expect(
      Object.fromEntries(
        Object.entries(properties).map(([key, node]) => [key, [node.minimum, node.maximum]]),
      ),
    ).toEqual({ retries: [0, 10], retry_interval: [30, 86400], timeout: [10, 10080] });
    expect(designSettings.parallel).toMatchObject({ minimum: 1, maximum: 50 });
  });

  it("shows parallel's default, which the ForEach uses when it is not set", () => {
    const parallel = rows("adf-copy").find((field) => field.path.join(".") === "parallel")!;
    expect(parallel.default).toBe(defaultParallel);
    expect(defaultParallel).toBe(4);
  });

  it("lists every audit value, with its type and meaning, in audit_columns", () => {
    const { description } = rows("adf-copy").find((field) => field.path[0] === "audit_columns")!;
    for (const [name, value] of Object.entries(auditValues)) {
      expect(description).toContain(`\`${name}\` (${value.type}): ${value.description}`);
    }
  });

  it("states how a layout is chosen and what each layout writes", () => {
    for (const method of ["adf-copy", "adf-table"]) {
      const layout = rows(method).find((field) => field.path.join(".") === "layout")!;
      expect(layout.values?.map((item) => item.value)).toEqual(["snapshot", "increments"]);
      expect(layout.description).toContain("`snapshot`");
      expect(layout.description).toContain("`increments`");
    }
  });
});
