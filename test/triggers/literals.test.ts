// A literal string the pack writes where ADF reads expressions: a trigger's parameter values and
// a pipeline parameter's default. ADF evaluates a string that starts with `@`, and `@{…}` inside
// one, so the pack escapes both as ADF documents: `@@` for a leading `@`, and `@@{` for `@{`.
import { describe, expect, it } from "vitest";
import { json } from "../erp.js";
import { errors, withTriggers } from "./flows.js";

const schedule = (value: string) => [
  "    - name: nightly",
  "      type: schedule",
  "      every: { frequency: Day, interval: 1 }",
  '      start: "2026-12-01T00:00:00Z"',
  `      parameters: { region: ${JSON.stringify(value)}, note: { expression: "@pipeline().RunId" } }`,
];

function built(value: string, fallback: string) {
  const ingest = `  parameters:\n    region: { type: string, default: ${JSON.stringify(fallback)} }\n    note: { type: string, default: x }\n`;
  const { result, files } = withTriggers(schedule(value), { ingest });
  expect(errors(result)).toEqual([]);
  return {
    sent: json(files, "trigger/tr_erp_erp_b_nightly.json").properties.pipelines[0].parameters,
    declared: json(files, "pipeline/pl_erp_erp_b.json").properties.parameters,
  };
}

describe("a literal string where ADF reads expressions", () => {
  it("doubles a leading @ in a trigger's value", () => {
    expect(built("@home", "x").sent.region).toBe("@@home");
  });

  it("doubles the @ of each @{ inside a value and a default", () => {
    const { sent, declared } = built("eu@{1}", "@{pipeline().RunId}");
    expect(sent.region).toBe("eu@@{1}");
    expect(declared.region.defaultValue).toBe("@@{pipeline().RunId}");
  });

  it("leaves other text, and an expression, as written", () => {
    const { sent, declared } = built("a@b", "plain");
    expect(sent.region).toBe("a@b");
    expect(declared.region.defaultValue).toBe("plain");
    expect(sent.note).toEqual({ type: "Expression", value: "@pipeline().RunId" });
  });
});
