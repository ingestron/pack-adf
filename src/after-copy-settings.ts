// after_copy: the Container Apps job ADF starts after each schedule's copies,
// and how long ADF waits for its run.
import type { Method, ResolvedModel } from "@ingestron/definitions";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const jobId = new RegExp(
  `^/subscriptions/${uuid}/resourceGroups/[-\\w.()]{1,90}/providers/Microsoft\\.App/jobs/[-\\w.()]+$`,
  "i",
);
const ninetyDays = 90 * 86400;

/** The default wait for the job's run, as an ADF timespan. */
export const defaultTimeout = "01:00:00";

/** after_copy's settings schema, one of every ADF method's window settings. */
export const afterCopySchema = {
  type: "object",
  additionalProperties: false,
  required: ["job"],
  properties: {
    job: {
      type: "string",
      description: "Resource ID of the Container Apps job to start after each schedule's copies.",
      examples: [
        "/subscriptions/<id>/resourceGroups/rg-data/providers/Microsoft.App/jobs/sales-job",
      ],
    },
    timeout: {
      type: "string",
      pattern: "^(\\d+\\.)?\\d{2}:\\d{2}:\\d{2}$",
      default: defaultTimeout,
      examples: ["01:00:00", "02:30:00"],
      description:
        "How long ADF waits for the job's run before stopping it and failing, as [d.]hh:mm:ss.",
    },
  },
  description: "A Container Apps job ADF starts after each schedule's copies, and waits for.",
};

/** Problems with a table's after_copy, as METHOD_CHECK messages. */
export function afterCopyProblems(settings: Record<string, unknown>): string[] {
  const value = settings.after_copy as { job?: unknown; timeout?: unknown } | undefined;
  if (!value) return [];
  const problems =
    typeof value.job === "string" && jobId.test(value.job)
      ? []
      : [
          "after_copy.job must be a Container Apps job resource ID, /subscriptions/<id>/resourceGroups/<group>/providers/Microsoft.App/jobs/<name>",
        ];
  const timeout = typeof value.timeout === "string" ? value.timeout : defaultTimeout;
  const seconds = timeoutSeconds(timeout);
  if (seconds === undefined || seconds <= 0 || seconds > ninetyDays)
    problems.push(
      `after_copy.timeout "${timeout}" must be more than zero and at most 90 days, as [d.]hh:mm:ss`,
    );
  return problems;
}

/** An ADF timespan in seconds; undefined unless [d.]hh:mm:ss with minutes and seconds under 60. */
export function timeoutSeconds(timeout: string): number | undefined {
  const match = /^(?:(\d+)\.)?(\d{2}):(\d{2}):(\d{2})$/.exec(timeout);
  if (!match) return undefined;
  const [days, hours, minutes, seconds] = [match[1] ?? "0", match[2], match[3], match[4]].map(
    Number,
  ) as [number, number, number, number];
  if (minutes > 59 || seconds > 59 || (match[1] !== undefined && hours > 23)) return undefined;
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

/** The method with after_copy's problems added to its own check. */
export function checkingAfterCopy(method: Method): Method {
  const check = method.check;
  return {
    ...method,
    check: (table, ...rest) => [
      ...(check?.(table, ...rest) ?? []),
      ...afterCopyProblems(table.ingest?.settings ?? {}),
    ],
  };
}

/** The project's after_copy, from its first ADF table, with the default timeout; undefined when none. */
export function afterCopyOf(model: ResolvedModel): { job: string; timeout: string } | undefined {
  const table = model.tables.find((candidate) => candidate.ingest?.pack === "adf");
  const value = table?.ingest?.settings.after_copy as { job: string; timeout?: string } | undefined;
  return value && { job: value.job, timeout: value.timeout ?? defaultTimeout };
}
