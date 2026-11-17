// With after_copy, a trigger a flow writes keeps its name and settings, but starts a parent
// pipeline of its own, which runs the flow's pipeline with the trigger's values, then the job.
import { describe, expect, it } from "vitest";
import { json, withAfterCopy } from "../erp.js";
import { errors, hourly, reload, withTriggers } from "./flows.js";

const job =
  "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.App/jobs/sales-job";
const standard = `${withAfterCopy(`{ job: "${job}" }`)}operations:\n  schedule: { per: flow }\n`;

function build() {
  const { result, files } = withTriggers([...hourly, ...reload], { standard });
  expect(errors(result)).toEqual([]);
  return files;
}

const run = (files: Record<string, string>, pipeline: string) =>
  json(files, `pipeline/${pipeline}.json`).properties.activities[0];

describe("after_copy with a flow's own triggers", () => {
  it("keeps each flow trigger, started on a parent pipeline of its own", () => {
    const files = build();
    expect(
      Object.keys(files)
        .filter((path) => path.startsWith("trigger/"))
        .sort(),
    ).toEqual([
      "trigger/tr_erp_erp_b_hourly_h1.json",
      "trigger/tr_erp_erp_b_weekly-reload.json",
      "trigger/tr_erp_every_24_hour.json",
    ]);
    const parent = json(files, "pipeline/pl_erp_every_24_hour.json").properties.activities;
    expect(parent.filter((item: { type: string }) => item.type === "ExecutePipeline")).toHaveLength(
      1,
    );
    expect(parent[0].typeProperties.pipeline.referenceName).toBe("pl_erp_erp");
  });

  it("moves a tumbling window's retries onto the flow pipeline's copies", () => {
    const files = build();
    const window = json(files, "trigger/tr_erp_erp_b_hourly_h1.json").properties;
    expect(window.pipeline.pipelineReference.referenceName).toBe("pl_erp_erp_b_hourly_h1");
    expect(window.typeProperties.retryPolicy).toEqual({ count: 0, intervalInSeconds: 300 });
    expect(window.typeProperties.dependsOn).toHaveLength(1);
    expect(run(files, "pl_erp_erp_b_hourly_h1").typeProperties).toMatchObject({
      pipeline: { referenceName: "pl_erp_erp_b", type: "PipelineReference" },
      parameters: {
        windowStart: "@pipeline().parameters.windowStart",
        windowEnd: "@pipeline().parameters.windowEnd",
      },
    });
    const copies = json(files, "pipeline/pl_erp_erp_b.json").properties.activities;
    expect(copies[0].policy).toMatchObject({ retry: 3, retryIntervalInSeconds: 300 });
  });

  it("passes a schedule's values, and only those, through its parent pipeline", () => {
    const files = build();
    const schedule = json(files, "trigger/tr_erp_erp_b_weekly-reload.json").properties;
    expect(schedule.pipelines).toEqual([
      {
        pipelineReference: {
          referenceName: "pl_erp_erp_b_weekly-reload",
          type: "PipelineReference",
        },
        parameters: {
          windowStart: "@trigger().scheduledTime",
          windowEnd: "@trigger().scheduledTime",
          load: "full",
        },
      },
    ]);
    const parent = json(files, "pipeline/pl_erp_erp_b_weekly-reload.json").properties;
    expect(parent.parameters).toEqual({
      windowStart: { type: "string" },
      windowEnd: { type: "string" },
      load: { type: "String", defaultValue: "full" },
    });
    expect(run(files, "pl_erp_erp_b_weekly-reload").typeProperties.parameters).toEqual({
      windowStart: "@pipeline().parameters.windowStart",
      windowEnd: "@pipeline().parameters.windowEnd",
      load: "@pipeline().parameters.load",
    });
  });
});
