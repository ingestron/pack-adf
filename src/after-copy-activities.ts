// The parent pipeline's activities: run the schedule's copies, start the
// Container Apps job, wait for its run, fail unless it succeeded, and stop it
// when it is still going at the timeout.
type Data = Record<string, unknown>;

const api = "?api-version=2026-07-01";
const arm = "https://management.azure.com";
const msi = { type: "MSI", resource: "https://management.azure.com/" };
const after = (activity: string, condition = "Succeeded") => ({
  activity,
  dependencyConditions: [condition],
});
const expression = (value: string) => ({ value, type: "Expression" });

/** The parent pipeline for one schedule's connection pipelines. */
export function parentPipeline(
  name: string,
  children: string[],
  job: { job: string; timeout: string },
): Data {
  return {
    name,
    properties: {
      description: "Runs the schedule's copies, then the job after them, and waits for it.",
      parameters: { windowStart: { type: "string" }, windowEnd: { type: "string" } },
      variables: {
        execution: { type: "String" },
        job_status: { type: "String", defaultValue: "Running" },
      },
      activities: [
        ...children.map(copyActivity),
        ...startActivities(job.job, children),
        waitActivity(job.job, job.timeout),
        checkActivity(),
        ...stopActivities(job.job, job.timeout),
      ],
    },
  };
}

function copyActivity(child: string): Data {
  return {
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

function setVariable(name: string, variable: string, value: string, dependsOn: Data[]): Data {
  return {
    name,
    type: "SetVariable",
    dependsOn,
    typeProperties: { variableName: variable, value: expression(value) },
  };
}

const executionUrl = (job: string, tail: string) =>
  expression(`@concat('${arm}${job}/executions/', variables('execution'), '${tail}${api}')`);

/** Start the job once, with no retry, and keep its run's name: a missing name fails here, at once. */
function startActivities(job: string, children: string[]): Data[] {
  return [
    web("start_job", "POST", `${arm}${job}/start${api}`, {
      dependsOn: children.map((child) => after(`run_${child}`)),
      policy: { retry: 0 },
    }),
    setVariable("remember_job", "execution", "@activity('start_job').output.name", [
      after("start_job"),
    ]),
  ];
}

/** Read the run's status every 30 seconds until it ends; a status that cannot be read ends the wait. */
function waitActivity(job: string, timeout: string): Data {
  return {
    name: "wait_for_job",
    type: "Until",
    dependsOn: [after("remember_job")],
    typeProperties: {
      expression: expression(
        "@not(contains(createArray('Running','Processing','Degraded','Unknown'), variables('job_status')))",
      ),
      timeout,
      activities: [
        { name: "pause", type: "Wait", typeProperties: { waitTimeInSeconds: 30 } },
        web("get_job_status", "GET", executionUrl(job, ""), {
          dependsOn: [after("pause")],
          policy: { retry: 3, retryIntervalInSeconds: 30 },
        }),
        setVariable(
          "set_job_status",
          "job_status",
          "@activity('get_job_status').output.properties.status",
          [after("get_job_status")],
        ),
        setVariable(
          "status_unreadable",
          "job_status",
          "@concat('unreadable: ', activity('get_job_status').error.message)",
          [after("get_job_status", "Failed")],
        ),
      ],
    },
  };
}

function fail(name: string, message: unknown, errorCode: string, dependsOn: Data[] = []): Data {
  return { name, type: "Fail", dependsOn, typeProperties: { message, errorCode } };
}

function checkActivity(): Data {
  return {
    name: "check_job",
    type: "IfCondition",
    dependsOn: [after("wait_for_job")],
    typeProperties: {
      expression: expression("@equals(variables('job_status'), 'Succeeded')"),
      ifFalseActivities: [
        fail(
          "job_failed",
          expression("@concat('The job after the copies ended ', variables('job_status'), '.')"),
          "500",
        ),
      ],
    },
  };
}

/** At the timeout, stop the run, and say whether it stopped. */
function stopActivities(job: string, timeout: string): Data[] {
  return [
    web("stop_job", "POST", executionUrl(job, "/stop"), {
      dependsOn: [after("wait_for_job", "Failed")],
    }),
    fail(
      "job_timed_out",
      `The job after the copies did not finish within ${timeout}, so it was stopped.`,
      "504",
      [after("stop_job")],
    ),
    fail(
      "job_not_stopped",
      expression(
        `@concat('The job after the copies did not finish within ${timeout} and could not be stopped: ', activity('stop_job').error.message)`,
      ),
      "504",
      [after("stop_job", "Failed")],
    ),
  ];
}
