// Each trigger a flow writes becomes one ADF trigger on the flow's own pipeline: a tumbling
// window or a schedule, named after the pipeline and the trigger.
import { describe, expect, it } from "vitest";
import { json } from "../erp.js";
import { adf } from "../../src/index.js";
import { triggerName, windowsZone } from "../../src/triggers/index.js";
import { errors, hourly, perFlow, reload, trigger, withTriggers } from "./flows.js";

const pipeline = { referenceName: "pl_erp_erp_b", type: "PipelineReference" };

function files(lines: string[], options: Parameters<typeof withTriggers>[1] = {}) {
  const { result, files } = withTriggers(lines, options);
  expect(errors(result)).toEqual([]);
  return files;
}

describe("a tumbling-window trigger", () => {
  it("writes design example 1 exactly", () => {
    const written = json(files([...hourly, ...reload]), "trigger/tr_erp_erp_b_hourly_h1.json");
    expect(written).toEqual({
      name: "tr_erp_erp_b_hourly_h1",
      properties: {
        type: "TumblingWindowTrigger",
        runtimeState: "Stopped",
        annotations: ["ingestron:flow-trigger"],
        typeProperties: {
          frequency: "Hour",
          interval: 1,
          startTime: "2026-12-01T00:00:00Z",
          delay: "00:05:00",
          maxConcurrency: 1,
          retryPolicy: { count: 3, intervalInSeconds: 300 },
          dependsOn: [
            { type: "SelfDependencyTumblingWindowTriggerReference", offset: "-01:00:00" },
          ],
        },
        pipeline: {
          pipelineReference: pipeline,
          parameters: {
            windowStart: "@trigger().outputs.windowStartTime",
            windowEnd: "@trigger().outputs.windowEndTime",
          },
        },
      },
    });
  });

  it("takes concurrency and retries from the standard's operations when it writes none", () => {
    const plain = hourly.slice(0, 4);
    const standard = perFlow(
      "  concurrency: { max_runs: 3, queue: true }\n  retries: { count: 4, interval: 2m }\n",
    );
    const written = json(files(plain, { standard }), "trigger/tr_erp_erp_b_hourly_h1.json");
    expect(written.properties.typeProperties).toMatchObject({
      maxConcurrency: 3,
      retryPolicy: { count: 4, intervalInSeconds: 120 },
    });
    expect(written.properties.typeProperties).not.toHaveProperty("delay");
  });

  it("keeps today's defaults without them: one at a time, the method's retries every 300 s", () => {
    const written = json(files(hourly.slice(0, 4)), "trigger/tr_erp_erp_b_hourly_h1.json");
    expect(written.properties.typeProperties).toMatchObject({
      maxConcurrency: 1,
      retryPolicy: { count: 2, intervalInSeconds: 300 },
    });
  });

  it("starts in UTC, converted from a local start in its zone", () => {
    const local = hourly
      .slice(0, 3)
      .concat(['      start: "2026-07-01T00:00:00"', "      timezone: Europe/London"]);
    const written = json(files(local), "trigger/tr_erp_erp_b_hourly_h1.json");
    expect(written.properties.typeProperties.startTime).toBe("2026-06-30T23:00:00Z");
    expect(written.properties.typeProperties).not.toHaveProperty("timeZone");
  });

  it("names another flow's trigger it depends on by its generated name", () => {
    const flowC = [
      "apiVersion: ingestron.io/v1\nkind: Flow\nid: c\nsource: erp\ningest:\n  triggers:",
      ...hourly.slice(0, 4).map((line) => line.replace("hourly", "after")),
      "      depends_on: [{ trigger: b/hourly, offset: -1h, size: 2h }]",
      "tables:\n  notes: { object: erp.dbo.Notes, contract: invoices }\n",
    ].join("\n");
    const written = json(
      files(hourly.slice(0, 4), { changes: { "flow-c.yaml": flowC } }),
      "trigger/tr_erp_erp_c_after_h1.json",
    );
    expect(written.properties.typeProperties.dependsOn).toEqual([
      {
        type: "TumblingWindowTriggerDependencyReference",
        size: "02:00:00",
        offset: "-01:00:00",
        referenceTrigger: { referenceName: "tr_erp_erp_b_hourly_h1", type: "TriggerReference" },
      },
    ]);
  });
});

describe("a schedule trigger", () => {
  it("writes design example 2 in the zone's Windows name and local time", () => {
    const written = json(files([...hourly, ...reload]), "trigger/tr_erp_erp_b_weekly-reload.json");
    expect(written.properties.type).toBe("ScheduleTrigger");
    expect(written.properties.typeProperties.recurrence).toEqual({
      frequency: "Week",
      interval: 1,
      startTime: "2026-07-05T02:00:00",
      timeZone: "GMT Standard Time",
      schedule: { weekDays: ["Sunday"], hours: [2], minutes: [0] },
    });
    expect(written.properties.pipelines).toEqual([
      {
        pipelineReference: pipeline,
        parameters: {
          windowStart: "@trigger().scheduledTime",
          windowEnd: "@trigger().scheduledTime",
          load: "full",
        },
      },
    ]);
  });

  it("writes UTC with a Z, an expression as an Expression, and paused: true as Stopped", () => {
    const daily = [
      "    - name: daily",
      "      type: schedule",
      "      every: { frequency: Day, interval: 1 }",
      '      start: "2026-12-01T03:00:00Z"',
      '      end: "2027-12-01T03:00:00Z"',
      "      paused: true",
      "      parameters:",
      "        min_date: { expression: \"@formatDateTime(trigger().scheduledTime, 'yyyy-MM-dd')\" }",
    ];
    const declared = "  parameters:\n    min_date: { type: date, default: '2020-01-01' }\n";
    const options = { ingest: declared, environment: "prod" };
    const written = json(files(daily, options), "trigger/tr_erp_erp_b_daily.json");
    expect(written.properties.runtimeState).toBe("Stopped");
    expect(written.properties.typeProperties.recurrence).toEqual({
      frequency: "Day",
      interval: 1,
      startTime: "2026-12-01T03:00:00Z",
      endTime: "2027-12-01T03:00:00Z",
      timeZone: "UTC",
    });
    expect(written.properties.pipelines[0].parameters).toEqual({
      windowStart: "@trigger().scheduledTime",
      windowEnd: "@trigger().scheduledTime",
      min_date: {
        type: "Expression",
        value: "@formatDateTime(trigger().scheduledTime, 'yyyy-MM-dd')",
      },
    });
  });

  it("is listed by the platform request with its recurrence", () => {
    const { result } = withTriggers([...hourly, ...reload]);
    const lines = adf.request!(result.model!)[0]!.lines;
    expect(lines).toContain(
      "Data Factory trigger `tr_erp_erp_b_weekly-reload`: every week, stopped.",
    );
    expect(lines).toContain("Data Factory trigger `tr_erp_erp_b_hourly_h1`: every hour, stopped.");
  });

  it("runs in prod, and replaces the flow pipeline's single default trigger", () => {
    const written = files(reload, { environment: "prod" });
    expect(json(written, "trigger/tr_erp_erp_b_weekly-reload.json").properties.runtimeState).toBe(
      "Started",
    );
    expect(written["trigger/tr_erp_erp_b.json"]).toBeUndefined();
    expect(written["trigger/tr_erp_erp.json"]).toBeDefined();
  });
});

describe("names and zones", () => {
  it("names a tumbling window by its frequency and interval, so changing them renames it", () => {
    const hour = trigger({ name: "hourly" });
    expect(triggerName("pl_erp_erp_b", hour)).toBe("tr_erp_erp_b_hourly_h1");
    expect(
      triggerName("pl_erp_erp_b", { ...hour, every: { frequency: "Hour", interval: 2 } }),
    ).toBe("tr_erp_erp_b_hourly_h2");
    expect(triggerName("pl_x", { ...hour, every: { frequency: "Minute", interval: 15 } })).toBe(
      "tr_x_hourly_m15",
    );
    expect(triggerName("pl_x", { ...hour, every: { frequency: "Month", interval: 1 } })).toBe(
      "tr_x_hourly_mo1",
    );
    expect(triggerName("pl_x", trigger({ name: "weekly-reload", type: "schedule" }))).toBe(
      "tr_x_weekly-reload",
    );
  });

  it("maps IANA zones, and their aliases, to Windows zones", () => {
    expect(windowsZone("Europe/London")).toBe("GMT Standard Time");
    expect(windowsZone("Asia/Kolkata")).toBe("India Standard Time");
    expect(windowsZone("UTC")).toBe("UTC");
    expect(windowsZone("Mars/Base")).toBeUndefined();
  });

  it("leaves no zone of the CLDR table out", () => {
    expect(windowsZone("Antarctica/McMurdo")).toBeDefined();
  });
});
