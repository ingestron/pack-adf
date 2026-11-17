// A trigger's times are read as definitions reads them: an offset makes an instant, a time
// without one is the zone's wall-clock time, a skipped time falls after the change and a
// repeated time is the first of the two.
import { describe, expect, it } from "vitest";
import { json } from "../erp.js";
import { triggerLimits, tumblingTrigger } from "../../src/triggers/index.js";
import { errors, hourly, modelOf, trigger, withTriggers } from "./flows.js";

const model = modelOf(withTriggers(hourly.slice(0, 4)).result);
const startTime = (start: string, timezone: string) =>
  (
    tumblingTrigger(model, trigger({ start, timezone }), "pl_x", "tr_x", new Map()) as {
      properties: { typeProperties: { startTime: string } };
    }
  ).properties.typeProperties.startTime;

describe("a tumbling window's local start, in UTC", () => {
  it("falls after the change for a time the clocks skip, east and west of UTC", () => {
    expect(startTime("2026-03-29T02:30:00", "Europe/Berlin")).toBe("2026-03-29T01:30:00Z");
    expect(startTime("2026-03-08T02:30:00", "America/New_York")).toBe("2026-03-08T07:30:00Z");
  });

  it("is the first of the two for a time the clocks repeat, east and west of UTC", () => {
    expect(startTime("2026-10-25T01:30:00", "Europe/London")).toBe("2026-10-25T00:30:00Z");
    expect(startTime("2026-10-25T02:30:00", "Europe/Berlin")).toBe("2026-10-25T00:30:00Z");
    expect(startTime("2026-11-01T01:30:00", "America/New_York")).toBe("2026-11-01T05:30:00Z");
  });

  it("reads an offset written without a colon", () => {
    expect(startTime("2026-12-01T00:00:00+0100", "UTC")).toBe("2026-11-30T23:00:00Z");
    const ends = trigger({
      type: "schedule",
      start: "2026-12-01T00:00:00+0100",
      end: "2026-11-30T22:00:00Z",
    });
    expect(triggerLimits(ends)).toEqual([
      'The trigger "b/x" ends at 2026-11-30T22:00:00Z, which is not after its start, 2026-12-01T00:00:00+0100',
    ]);
  });
});

describe("a schedule's times", () => {
  const daily = (lines: string[]) => [
    "    - name: daily",
    "      type: schedule",
    "      every: { frequency: Day, interval: 1 }",
    ...lines,
  ];

  it("keeps a local start without Z as written, in the zone's Windows name", () => {
    const local = daily(['      start: "2026-12-06T02:00:00"', "      timezone: America/New_York"]);
    const { result, files } = withTriggers(local);
    expect(errors(result)).toEqual([]);
    expect(
      json(files, "trigger/tr_erp_erp_b_daily.json").properties.typeProperties.recurrence,
    ).toEqual({
      frequency: "Day",
      interval: 1,
      startTime: "2026-12-06T02:00:00",
      timeZone: "Eastern Standard Time",
    });
  });

  it("passes only the window when the trigger sets no parameters", () => {
    const { result, files } = withTriggers(daily(['      start: "2026-12-06T02:00:00Z"']));
    expect(errors(result)).toEqual([]);
    expect(
      json(files, "trigger/tr_erp_erp_b_daily.json").properties.pipelines[0].parameters,
    ).toEqual({ windowStart: "@trigger().scheduledTime", windowEnd: "@trigger().scheduledTime" });
  });
});
