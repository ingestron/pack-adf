// With after_copy, each schedule's copies run from one parent pipeline that
// then starts the Container Apps job, waits for its run, and stops it at the timeout.
import { describe, expect, it } from "vitest";
import { adf } from "../src/index.js";
import { base, generate, json, withAfterCopy } from "./erp.js";

const job =
  "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.App/jobs/sales-job";
const arm = "https://management.azure.com";
const msi = { type: "MSI", resource: "https://management.azure.com/" };

interface Activity {
  name: string;
  type: string;
  dependsOn?: { activity: string; dependencyConditions: string[] }[];
  policy?: { retry?: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ADF JSON read back in tests
  typeProperties: Record<string, any>;
}

/** A second connection, crm, with its own flow and schedule settings. */
function crm(every?: string): Record<string, string> {
  const settings = every ? `ingest: { with: { every: ${every} } }\n` : "";
  return {
    "crm.yaml": base["erp.yaml"]!.replace("id: erp", "id: crm"),
    "crm-flow.yaml": `apiVersion: ingestron.io/v1\nkind: Flow\nid: crm\nsource: crm\n${settings}tables:\n  accounts: { object: crm.dbo.Accounts, contract: invoices }\n`,
  };
}

function build(afterCopy = `{ job: "${job}" }`, changes: Record<string, string> = crm()) {
  const { result, files } = generate({ "standard.yaml": withAfterCopy(afterCopy), ...changes });
  expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return { files, model: result.model! };
}

const activities = (files: Record<string, string>, pipeline: string) =>
  json(files, `pipeline/${pipeline}.json`).properties.activities as Activity[];
const named = (list: Activity[], name: string) => list.find((item) => item.name === name)!;

describe("after_copy", () => {
  it("starts the job once after every copy of the schedule", () => {
    const { files } = build();
    const triggers = Object.keys(files).filter((path) => path.startsWith("trigger/"));
    expect(triggers).toEqual(["trigger/tr_erp_every_24_hour.json"]);
    expect(json(files, triggers[0]!).properties.pipeline.pipelineReference.referenceName).toBe(
      "pl_erp_every_24_hour",
    );
    const parent = activities(files, "pl_erp_every_24_hour");
    for (const child of ["run_pl_erp_erp", "run_pl_erp_crm"]) {
      expect(named(parent, child).type).toBe("ExecutePipeline");
      expect(named(parent, child).dependsOn ?? []).toEqual([]);
      expect(named(parent, child).typeProperties.waitOnCompletion).toBe(true);
    }
    const start = named(parent, "start_job");
    expect(start.dependsOn).toEqual([
      { activity: "run_pl_erp_crm", dependencyConditions: ["Succeeded"] },
      { activity: "run_pl_erp_erp", dependencyConditions: ["Succeeded"] },
    ]);
    expect(start.typeProperties).toMatchObject({
      method: "POST",
      url: `${arm}${job}/start?api-version=2026-07-01`,
      authentication: msi,
    });
    expect(start.policy?.retry).toBe(0);
  });

  it("waits for the run and fails when it does not succeed", () => {
    const parent = activities(build().files, "pl_erp_every_24_hour");
    const wait = named(parent, "wait_for_job");
    expect(wait.typeProperties.timeout).toBe("01:00:00");
    expect(wait.typeProperties.expression.value).toBe(
      "@not(contains(createArray('Running','Processing','Degraded','Unknown'), variables('job_status')))",
    );
    expect(wait.typeProperties.activities.map((item: Activity) => item.name)).toEqual([
      "pause",
      "get_job_status",
      "set_job_status",
      "status_unreadable",
    ]);
    const check = named(parent, "check_job");
    expect(check.dependsOn).toEqual([
      { activity: "wait_for_job", dependencyConditions: ["Succeeded"] },
    ]);
    expect(check.typeProperties.ifFalseActivities.map((item: Activity) => item.type)).toEqual([
      "Fail",
    ]);
  });

  it("stops a run that is still going at the timeout", () => {
    const parent = activities(
      build(`{ job: "${job}", timeout: "02:30:00" }`).files,
      "pl_erp_every_24_hour",
    );
    const stop = named(parent, "stop_job");
    expect(stop.dependsOn).toEqual([
      { activity: "wait_for_job", dependencyConditions: ["Failed"] },
    ]);
    expect(stop.typeProperties.url.value).toMatch(/\/stop\?api-version=2026-07-01'\)$/);
    const failed = named(parent, "job_timed_out");
    expect(failed.dependsOn).toEqual([
      { activity: "stop_job", dependencyConditions: ["Succeeded"] },
    ]);
    expect(failed.typeProperties.message).toContain("within 02:30:00");
  });

  it("makes one parent per schedule", () => {
    const { files } = build(undefined, crm("{ frequency: Hour, interval: 1 }"));
    const triggers = Object.keys(files).filter((path) => path.startsWith("trigger/"));
    expect(triggers.sort()).toEqual([
      "trigger/tr_erp_every_1_hour.json",
      "trigger/tr_erp_every_24_hour.json",
    ]);
    for (const parent of ["pl_erp_every_1_hour", "pl_erp_every_24_hour"])
      expect(named(activities(files, parent), "start_job").typeProperties.url).toBe(
        `${arm}${job}/start?api-version=2026-07-01`,
      );
  });

  it("keeps a paused schedule paused", () => {
    const standard = withAfterCopy(`{ job: "${job}" }`).replace(
      "      start: 2026-10-01T00:00:00Z\n",
      "      start: 2026-10-01T00:00:00Z\n      paused: true\n",
    );
    const { files } = generate({ "standard.yaml": standard, ...crm() });
    expect(json(files, "trigger/tr_erp_every_24_hour.json").properties.runtimeState).toBe(
      "Stopped",
    );
  });

  it("asks for the job's permissions and limits", () => {
    const lines = adf.request!(build().model).flatMap((section) => section.lines);
    expect(lines).toContain(
      "The factory's managed identity needs the Container Apps Jobs Operator role on `sales-job`, or a custom role with Microsoft.App/jobs/read, start/action, stop/execution/action and executions/read.",
    );
    expect(lines).toContain(
      "Set `sales-job`'s replica timeout to 1800 seconds and retry limit to 1, so a retried run ends within after_copy.timeout (01:00:00).",
    );
  });

  it("retries a failed copy in place, not the whole schedule", () => {
    const { files } = build();
    expect(
      json(files, "trigger/tr_erp_every_24_hour.json").properties.typeProperties.retryPolicy,
    ).toEqual({
      count: 0,
      intervalInSeconds: 300,
    });
    const copies = activities(files, "pl_erp_erp").filter((item) => item.type === "Copy");
    expect(copies.length).toBeGreaterThan(0);
    for (const copy of copies)
      expect(copy.policy).toMatchObject({ retry: 2, retryIntervalInSeconds: 300 });
  });

  it("fails at once when the start call gives no run name", () => {
    const parent = activities(build().files, "pl_erp_every_24_hour");
    const remember = named(parent, "remember_job");
    expect(remember.type).toBe("SetVariable");
    expect(remember.dependsOn).toEqual([
      { activity: "start_job", dependencyConditions: ["Succeeded"] },
    ]);
    expect(remember.typeProperties).toMatchObject({
      variableName: "execution",
      value: { value: "@activity('start_job').output.name", type: "Expression" },
    });
    expect(named(parent, "wait_for_job").dependsOn).toEqual([
      { activity: "remember_job", dependencyConditions: ["Succeeded"] },
    ]);
    const status = named(named(parent, "wait_for_job").typeProperties.activities, "get_job_status");
    expect(status.typeProperties.url.value).toContain("variables('execution')");
    expect(named(parent, "stop_job").typeProperties.url.value).toContain("variables('execution')");
  });

  it("ends the wait when the run's status cannot be read", () => {
    const inner = named(activities(build().files, "pl_erp_every_24_hour"), "wait_for_job")
      .typeProperties.activities as Activity[];
    expect(named(inner, "get_job_status").policy).toMatchObject({
      retry: 3,
      retryIntervalInSeconds: 30,
    });
    const unreadable = named(inner, "status_unreadable");
    expect(unreadable.dependsOn).toEqual([
      { activity: "get_job_status", dependencyConditions: ["Failed"] },
    ]);
    expect(unreadable.typeProperties.value.value).toBe(
      "@concat('unreadable: ', activity('get_job_status').error.message)",
    );
  });

  it("says whether a run still going at the timeout was stopped", () => {
    const parent = activities(build().files, "pl_erp_every_24_hour");
    expect(named(parent, "job_timed_out").dependsOn).toEqual([
      { activity: "stop_job", dependencyConditions: ["Succeeded"] },
    ]);
    const notStopped = named(parent, "job_not_stopped");
    expect(notStopped.type).toBe("Fail");
    expect(notStopped.dependsOn).toEqual([
      { activity: "stop_job", dependencyConditions: ["Failed"] },
    ]);
    expect(notStopped.typeProperties.message.value).toContain("could not be stopped");
  });

  it("warns that turning after_copy on runs every window since start", () => {
    const lines = adf.request!(build().model).flatMap((section) => section.lines);
    expect(lines).toContain(
      "When you turn after_copy on, set `start` to the next window: the new triggers run every window since `start`, each copying again and starting the job.",
    );
  });
});
