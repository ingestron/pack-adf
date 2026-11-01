// With after_copy, each schedule's copies run from one parent pipeline, which
// then starts the Container Apps job, waits for its run, and stops it when it
// is still going at the timeout. The connection pipelines lose their triggers.
import type { ResolvedModel } from "@ingestron/definitions";
import { afterCopyOf } from "./after-copy-settings.js";

type Data = Record<string, unknown>;
interface Trigger {
  name: string;
  properties: {
    runtimeState: string;
    typeProperties: { frequency: string; interval: number } & Data;
    pipeline: { pipelineReference: { referenceName: string } } & Data;
  } & Data;
}

const api = "?api-version=2026-07-01";
const arm = "https://management.azure.com";
const msi = { type: "MSI", resource: "https://management.azure.com/" };
const execution = "activity('start_job').output.name";
const succeeded = (activity: string, condition = "Succeeded") => ({
  activity,
  dependencyConditions: [condition],
});

/** Replaces the connection pipelines' triggers with one parent pipeline and trigger per schedule. */
export function afterCopy(files: Record<string, string>, model: ResolvedModel): void {
  const job = afterCopyOf(model);
  if (!job) return;
  const groups = new Map<string, Trigger[]>();
  for (const [path, text] of Object.entries(files).filter(([path]) =>
    path.startsWith("trigger/"),
  )) {
    const trigger = JSON.parse(text) as Trigger;
    const key = JSON.stringify([
      trigger.properties.typeProperties,
      trigger.properties.runtimeState,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), trigger]);
    delete files[path];
  }
  const used = new Map<string, number>();
  for (const triggers of groups.values()) {
    const { frequency, interval } = triggers[0]!.properties.typeProperties;
    const base = `${model.project.id}_every_${interval}_${frequency.toLowerCase()}`;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    const suffix = count > 1 ? `_${count}` : "";
    const children = triggers
      .map((trigger) => trigger.properties.pipeline.pipelineReference.referenceName)
      .sort();
    const pipeline = `pl_${base}${suffix}`;
    files[`pipeline/${pipeline}.json`] = text(parentPipeline(pipeline, children, job));
    const trigger = parentTrigger(triggers[0]!, `tr_${base}${suffix}`, pipeline);
    files[`trigger/${trigger.name}.json`] = text(trigger);
  }
}

const text = (resource: unknown) => `${JSON.stringify(resource, null, "\t")}\n`;

function parentTrigger(first: Trigger, name: string, pipeline: string): Trigger {
  const reference = { ...first.properties.pipeline.pipelineReference, referenceName: pipeline };
  return {
    ...first,
    name,
    properties: {
      ...first.properties,
      pipeline: { ...first.properties.pipeline, pipelineReference: reference },
    },
  };
}

function parentPipeline(
  name: string,
  children: string[],
  job: { job: string; timeout: string },
): Data {
  const copies = children.map((child) => ({
    name: `run_${child}`,
    type: "ExecutePipeline",
    typeProperties: {
      pipeline: { referenceName: child, type: "PipelineReference" },
      waitOnCompletion: true,
      parameters: {
        windowStart: "@pipeline().parameters.windowStart",
        windowEnd: "@pipeline().parameters.windowEnd",
      },
    },
  }));
  return {
    name,
    properties: {
      description: "Runs the schedule's copies, then the job after them, and waits for it.",
      parameters: { windowStart: { type: "string" }, windowEnd: { type: "string" } },
      variables: { job_status: { type: "String", defaultValue: "Running" } },
      activities: [
        ...copies,
        startActivity(job.job, children),
        waitActivity(job),
        checkActivity(),
        ...stopActivities(job),
      ],
    },
  };
}

function web(name: string, method: string, url: unknown, extra: Data = {}): Data {
  return {
    name,
    type: "WebActivity",
    ...extra,
    typeProperties: { method, url, authentication: msi, ...(method === "POST" && { body: {} }) },
  };
}

const executionUrl = (job: string, tail: string) => ({
  value: `@concat('${arm}${job}/executions/', ${execution}, '${tail}${api}')`,
  type: "Expression",
});

function startActivity(job: string, children: string[]): Data {
  return web("start_job", "POST", `${arm}${job}/start${api}`, {
    dependsOn: children.map((child) => succeeded(`run_${child}`)),
    policy: { retry: 0 },
  });
}

function waitActivity({ job, timeout }: { job: string; timeout: string }): Data {
  return {
    name: "wait_for_job",
    type: "Until",
    dependsOn: [succeeded("start_job")],
    typeProperties: {
      expression: {
        value:
          "@not(contains(createArray('Running','Processing','Degraded','Unknown'), variables('job_status')))",
        type: "Expression",
      },
      timeout,
      activities: [
        { name: "pause", type: "Wait", typeProperties: { waitTimeInSeconds: 30 } },
        web("get_job_status", "GET", executionUrl(job, ""), { dependsOn: [succeeded("pause")] }),
        {
          name: "set_job_status",
          type: "SetVariable",
          dependsOn: [succeeded("get_job_status")],
          typeProperties: {
            variableName: "job_status",
            value: {
              value: "@activity('get_job_status').output.properties.status",
              type: "Expression",
            },
          },
        },
      ],
    },
  };
}

function checkActivity(): Data {
  return {
    name: "check_job",
    type: "IfCondition",
    dependsOn: [succeeded("wait_for_job")],
    typeProperties: {
      expression: { value: "@equals(variables('job_status'), 'Succeeded')", type: "Expression" },
      ifFalseActivities: [
        {
          name: "job_failed",
          type: "Fail",
          typeProperties: {
            message: {
              value: "@concat('The job after the copies ended ', variables('job_status'), '.')",
              type: "Expression",
            },
            errorCode: "500",
          },
        },
      ],
    },
  };
}

function stopActivities({ job, timeout }: { job: string; timeout: string }): Data[] {
  return [
    web("stop_job", "POST", executionUrl(job, "/stop"), {
      dependsOn: [succeeded("wait_for_job", "Failed")],
    }),
    {
      name: "job_timed_out",
      type: "Fail",
      dependsOn: [succeeded("stop_job", "Completed")],
      typeProperties: {
        message: `The job after the copies did not finish within ${timeout}, so it was stopped.`,
        errorCode: "504",
      },
    },
  ];
}
