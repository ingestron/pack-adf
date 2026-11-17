// What ADF refuses in a trigger, checked before anything is generated, and the standard's
// trigger rules applied to the default trigger.
import { describe, expect, it } from "vitest";
import { base, generate } from "../erp.js";
import { triggerLimits } from "../../src/triggers/index.js";
import { errors, hourly, perFlow, trigger, withTriggers } from "./flows.js";

const schedule = (over: Parameters<typeof trigger>[0]) => trigger({ type: "schedule", ...over });
const day = { frequency: "Day", interval: 1 } as const;

describe("triggerLimits", () => {
  const cases: [string, ReturnType<typeof trigger>, string][] = [
    [
      "weekdays without Week",
      schedule({ every: day, at: { weekdays: ["Sunday"] } }),
      'The trigger "b/x" sets `at.weekdays`, which ADF allows only with frequency Week',
    ],
    [
      "month days without Month",
      schedule({ every: day, at: { month_days: [1] } }),
      'The trigger "b/x" sets `at.month_days`, which ADF allows only with frequency Month',
    ],
    [
      "occurrences without Month",
      schedule({ every: day, at: { occurrences: [{ day: "Monday" }] } }),
      'The trigger "b/x" sets `at.occurrences`, which ADF allows only with frequency Month',
    ],
    [
      "an interval over 1000",
      schedule({ every: { frequency: "Minute", interval: 1001 } }),
      'The trigger "b/x" has interval 1001; ADF allows 1 to 1000',
    ],
    [
      "a window under 5 minutes",
      trigger({ every: { frequency: "Minute", interval: 4 } }),
      'The trigger "b/x" has a window of 4 minutes; ADF\'s shortest tumbling window is 5 minutes',
    ],
    [
      "a tumbling window by Day",
      trigger({ every: day }),
      'The trigger "b/x" is a tumbling window by Day; ADF\'s tumbling windows are by Minute, Hour or Month. Write 24 hours for a day, or 168 for a week',
    ],
    [
      "concurrency over 50",
      trigger({ concurrency: 51 }),
      'The trigger "b/x" has concurrency 51; ADF allows 1 to 50',
    ],
    [
      "a retry interval under 30 s",
      trigger({ retries: { count: 1, interval: "10s" } }),
      'The trigger "b/x" retries after 10s; ADF waits at least 30 seconds between retries',
    ],
    [
      "more than five dependencies",
      trigger({ depends_on: Array.from({ length: 6 }, () => ({ trigger: "a/y", offset: "-1h" })) }),
      'The trigger "b/x" depends on 6 triggers; ADF allows at most 5',
    ],
    [
      "a self-dependency without a negative offset",
      trigger({ depends_on: [{ self: true, offset: "1h" }] }),
      'The trigger "b/x" depends on itself, which ADF allows only with a negative offset, such as -1h',
    ],
    [
      "an end before the start",
      schedule({ end: "2026-11-30T00:00:00Z" }),
      'The trigger "b/x" ends at 2026-11-30T00:00:00Z, which is not after its start, 2026-12-01T00:00:00Z',
    ],
    [
      "a zone with no Windows name",
      schedule({ timezone: "CST6CDT" }),
      'The trigger "b/x" uses the time zone CST6CDT, which has no Windows time zone name, so ADF cannot schedule it',
    ],
  ];
  for (const [name, given, message] of cases)
    it(`refuses ${name}`, () => expect(triggerLimits(given)).toEqual([message]));

  it("refuses a dependency on itself by name, with no offset or a positive one", () => {
    const self =
      'The trigger "b/x" depends on itself, which ADF allows only with a negative offset, such as -1h';
    for (const named of ["x", "b/x"]) {
      expect(triggerLimits(trigger({ depends_on: [{ trigger: named }] }))).toEqual([self]);
      expect(triggerLimits(trigger({ depends_on: [{ trigger: named, offset: "0s" }] }))).toEqual([
        self,
      ]);
      expect(triggerLimits(trigger({ depends_on: [{ trigger: named, offset: "-1h" }] }))).toEqual(
        [],
      );
    }
  });

  it("accepts the limits themselves", () => {
    expect(
      triggerLimits(trigger({ every: { frequency: "Minute", interval: 5 }, concurrency: 50 })),
    ).toEqual([]);
    expect(
      triggerLimits(
        schedule({ every: { frequency: "Month", interval: 1000 }, timezone: "Europe/London" }),
      ),
    ).toEqual([]);
    expect(triggerLimits(trigger({ retries: { count: 1, interval: "30s" } }))).toEqual([]);
  });
});

describe("the pack's check", () => {
  it("reports a limit, and a second tumbling window on one pipeline", () => {
    const second = hourly.slice(0, 4).map((line) => line.replace("hourly", "again"));
    const retries = "      retries: { count: 1, interval: 10s }";
    const { result } = withTriggers([...hourly.slice(0, 4), ...second, retries]);
    expect(errors(result)).toEqual(
      expect.arrayContaining([
        'The trigger "b/again" retries after 10s; ADF waits at least 30 seconds between retries.',
        'The flow "b" has two tumbling-window triggers, "hourly" and "again", on one pipeline; ADF would load each window twice. Keep one.',
      ]),
    );
  });

  it("leaves a flow's own concurrency over 50 to the schema, which finds the value", () => {
    const { result } = withTriggers([...hourly.slice(0, 4), "      concurrency: 60"]);
    expect(errors(result)).toEqual(["ingest.triggers[0].concurrency must be at most 50."]);
  });
});

describe("a tumbling window's defaults from the standard", () => {
  const operations = (lines: string) => perFlow(lines);

  it("are held to ADF's limits, naming where they came from", () => {
    const standard = operations(
      "  concurrency: { max_runs: 60, queue: true }\n  retries: { count: 2, interval: 10s }\n",
    );
    const { result } = withTriggers(hourly.slice(0, 4), { standard });
    expect(errors(result)).toEqual([
      'The trigger "b/hourly" takes concurrency 60 from the standard\'s `operations.concurrency.max_runs`; ADF allows 1 to 50.',
      'The trigger "b/hourly" takes the retry interval 10s from the standard\'s `operations.retries`; ADF waits at least 30 seconds between retries.',
    ]);
  });

  it("are not checked where the trigger writes its own, nor for a schedule", () => {
    const standard = operations(
      "  concurrency: { max_runs: 60, queue: true }\n  retries: { count: 2, interval: 10s }\n",
    );
    const own = [
      ...hourly.slice(0, 4),
      "      concurrency: 1",
      "      retries: { count: 1, interval: 30s }",
    ];
    expect(errors(withTriggers(own, { standard }).result)).toEqual([]);
    const daily = [
      "    - name: daily",
      "      type: schedule",
      "      every: { frequency: Day, interval: 1 }",
      '      start: "2026-12-01T03:00:00Z"',
    ];
    expect(errors(withTriggers(daily, { standard }).result)).toEqual([]);
  });
});

describe("the standard's trigger rules on the default trigger", () => {
  const standard = (triggers: string) =>
    base["standard.yaml"]!.replace(
      "      start:",
      "      every: { frequency: Hour, interval: 1 }\n      start:",
    ) + `operations:\n  triggers: ${triggers}\n`;

  it("reports a start outside the allowed hours", () => {
    const { result } = generate({
      "standard.yaml": standard('{ hours: { from: "22:00", to: "06:00" } }'),
    });
    expect(errors(result)).toEqual([
      '"tr_erp_erp" starts a run at 06:00 (UTC), outside the hours the standard allows here: 22:00–06:00.',
    ]);
  });

  it("reports a type the standard does not allow", () => {
    const { result } = generate({ "standard.yaml": standard("{ types: [schedule] }") });
    expect(errors(result)).toEqual([
      "The standard allows only schedule triggers. The default trigger \"tr_erp_erp\" is a tumbling-window trigger; write the flow's own triggers, or ask for tumbling-window in the standard's `operations.triggers.types`.",
    ]);
  });

  it("says nothing when the default trigger keeps to them", () => {
    const { result } = generate({
      "standard.yaml": standard(
        '{ types: [tumbling-window], hours: { from: "00:00", to: "23:59" } }',
      ),
    });
    expect(errors(result)).toEqual([]);
  });
});
