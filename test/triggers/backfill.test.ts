// A new tumbling-window trigger a flow writes, with a start in the past, is refused until the
// engineer confirms it: ADF would run every past window again.
import { describe, expect, it } from "vitest";
import { generate } from "../erp.js";
import { adf } from "../../src/index.js";
import { pastWindows } from "../../src/triggers/index.js";
import { errors, hourly, withTriggers } from "./flows.js";

const now = new Date("2026-12-02T00:00:00Z");
const path = "trigger/tr_erp_erp_b_hourly_h1.json";

function flowFiles(lines: string[]) {
  const { result, files } = withTriggers(lines);
  expect(errors(result)).toEqual([]);
  return files;
}

const refused = (path_: string, start: string, n: number) =>
  `tr_${path_} is new and starts at ${start}: ADF would run ${n} past windows again. Move \`start\` to now or later, or write \`backfill: true\` on the trigger.`;

const hourlyAt = (start: string, extra: string[] = []) => [
  "    - name: hourly",
  "      type: tumbling-window",
  "      every: { frequency: Hour, interval: 1 }",
  `      start: "${start}"`,
  ...extra,
];

describe("the backfill check", () => {
  it("refuses a new flow trigger that starts in the past, counting its windows", () => {
    const files = flowFiles(hourlyAt("2026-12-01T00:00:00Z"));
    expect(adf.checkFirstWrites!(files, new Set(["README.md"]), now)).toEqual([
      refused("erp_erp_b_hourly_h1", "2026-12-01T00:00:00Z", 24),
    ]);
  });

  it("refuses on a first generation too: nothing is generated before", () => {
    const files = flowFiles(hourlyAt("2026-12-01T00:00:00Z"));
    expect(adf.checkFirstWrites!(files, new Set(), now)).toHaveLength(1);
  });

  it("matches a trigger file below another folder, as the Synapse pack copies it", () => {
    const files = flowFiles(hourlyAt("2026-12-01T00:00:00Z"));
    const moved = { [`workspace/dev/${path}`]: files[path]! };
    expect(adf.checkFirstWrites!(moved, new Set(), now)).toHaveLength(1);
  });

  it("passes when the trigger's path is already generated", () => {
    const files = flowFiles(hourlyAt("2026-12-01T00:00:00Z"));
    expect(adf.checkFirstWrites!(files, new Set([path]), now)).toEqual([]);
  });

  it("passes with `backfill: true`, which is written as an annotation", () => {
    const files = flowFiles(hourlyAt("2026-12-01T00:00:00Z", ["      backfill: true"]));
    expect(JSON.parse(files[path]!).properties.annotations).toEqual([
      "ingestron:flow-trigger",
      "ingestron:backfill",
    ]);
    expect(adf.checkFirstWrites!(files, new Set(), now)).toEqual([]);
  });

  it("passes when the start is now or later", () => {
    const files = flowFiles(hourlyAt("2026-12-02T00:00:00Z"));
    expect(adf.checkFirstWrites!(files, new Set(), now)).toEqual([]);
    expect(adf.checkFirstWrites!(files, new Set(), new Date("2026-12-01T23:00:00Z"))).toEqual([]);
  });

  it("does not refuse a start less than one window ago: no window has run", () => {
    const files = flowFiles(hourlyAt("2026-12-01T23:30:00Z"));
    expect(adf.checkFirstWrites!(files, new Set(), now)).toEqual([]);
  });

  it("gives the problem for the new name when a change of size renames the trigger", () => {
    const first = flowFiles(hourlyAt("2026-12-02T00:00:00Z"));
    const renamed = flowFiles([
      ...hourlyAt("2026-12-01T00:00:00Z").slice(0, 2),
      "      every: { frequency: Hour, interval: 2 }",
      '      start: "2026-12-01T00:00:00Z"',
    ]);
    const generated = new Set(Object.keys(first));
    expect(adf.checkFirstWrites!(renamed, generated, now)).toEqual([
      refused("erp_erp_b_hourly_h2", "2026-12-01T00:00:00Z", 12),
    ]);
  });

  it("does not refuse a default trigger, even a new one with a start in the past", () => {
    const { files } = generate({});
    expect(files["trigger/tr_erp_erp.json"]).toContain("2026-10-01T00:00:00Z");
    expect(JSON.parse(files["trigger/tr_erp_erp.json"]!).properties).not.toHaveProperty(
      "annotations",
    );
    expect(adf.checkFirstWrites!(files, new Set(["README.md"]), now)).toEqual([]);
    expect(adf.checkFirstWrites!(files, new Set(), now)).toEqual([]);
  });

  it("does not refuse a schedule trigger or a file that is not JSON", () => {
    const files = { "trigger/x.json": "{", "pipeline/a.json": "{}", "trigger/y.json": "[]" };
    expect(adf.checkFirstWrites!(files, new Set(), now)).toEqual([]);
  });

  it("writes the flow marker on a flow's tumbling window, with a past start", () => {
    const files = flowFiles(hourly);
    expect(JSON.parse(files[path]!).properties.annotations).toEqual(["ingestron:flow-trigger"]);
  });
});

describe("counting past windows", () => {
  const start = Date.UTC(2026, 0, 31);
  it("counts whole hours and minutes", () => {
    expect(pastWindows("Hour", 1, start, start + 24 * 3_600_000)).toBe(24);
    expect(pastWindows("Hour", 6, start, start + 25 * 3_600_000)).toBe(4);
    expect(pastWindows("Minute", 15, start, start + 14 * 60_000)).toBe(0);
    expect(pastWindows("Minute", 15, start, start + 31 * 60_000)).toBe(2);
  });
  it("counts months by calendar, keeping to the month's last day", () => {
    expect(pastWindows("Month", 1, start, Date.UTC(2026, 1, 27))).toBe(0);
    expect(pastWindows("Month", 1, start, Date.UTC(2026, 1, 28))).toBe(1);
    expect(pastWindows("Month", 2, start, Date.UTC(2026, 8, 30))).toBe(4);
  });
  it("is zero before the start", () => {
    expect(pastWindows("Hour", 1, start, start - 1)).toBe(0);
  });
});
