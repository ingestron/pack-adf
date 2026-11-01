// after_copy: the Container Apps job ADF starts after each schedule's copies,
// and how long ADF waits for its run.
import type { Method, ResolvedModel } from "@ingestron/definitions";

const jobId =
  /^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.App\/jobs\/[-\w.()]+$/i;

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
      description:
        "How long ADF waits for the job's run before stopping it and failing, as [d.]hh:mm:ss.",
    },
  },
  description: "A Container Apps job ADF starts after each schedule's copies, and waits for.",
};

/** Problems with a table's after_copy, as METHOD_CHECK messages. */
export function afterCopyProblems(settings: Record<string, unknown>): string[] {
  const value = settings.after_copy as { job?: unknown } | undefined;
  if (!value || (typeof value.job === "string" && jobId.test(value.job))) return [];
  return [
    "after_copy.job must be a Container Apps job resource ID, /subscriptions/<id>/resourceGroups/<group>/providers/Microsoft.App/jobs/<name>",
  ];
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
