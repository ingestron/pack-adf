// What ADF refuses in a trigger a flow writes (spec/references.md, "Triggers"), as problems
// before anything is generated.
import type { ResolvedModel, ResolvedTrigger } from "@ingestron/definitions";
import { onItself } from "./tumbling-trigger.js";
import { durationMs, instantOf, windowsZone } from "./times.js";

/** The refinements of a schedule that ADF allows only with one frequency. */
const refinements = [
  ["weekdays", "Week"],
  ["month_days", "Month"],
  ["occurrences", "Month"],
] as const;

/** The frequencies of an ADF tumbling window. */
const windowFrequencies = new Set(["Minute", "Hour", "Month"]);

function scheduleLimits(trigger: ResolvedTrigger, named: string): string[] {
  return refinements
    .filter(([key, frequency]) => trigger.at?.[key] && trigger.every.frequency !== frequency)
    .map(
      ([key, frequency]) =>
        `${named} sets \`at.${key}\`, which ADF allows only with frequency ${frequency}`,
    );
}

function windowLimits(trigger: ResolvedTrigger, named: string): string[] {
  const { frequency, interval } = trigger.every;
  const problems: string[] = [];
  if (!windowFrequencies.has(frequency))
    problems.push(
      `${named} is a tumbling window by ${frequency}; ADF's tumbling windows are by Minute, Hour or Month. Write 24 hours for a day, or 168 for a week`,
    );
  if (frequency === "Minute" && interval < 5)
    problems.push(
      `${named} has a window of ${interval} minutes; ADF's shortest tumbling window is 5 minutes`,
    );
  const concurrency = trigger.concurrency;
  if (concurrency !== undefined && (concurrency < 1 || concurrency > 50))
    problems.push(`${named} has concurrency ${concurrency}; ADF allows 1 to 50`);
  const retry = trigger.retries && durationMs(trigger.retries.interval);
  if (retry !== undefined && retry < 30_000)
    problems.push(
      `${named} retries after ${trigger.retries!.interval}; ADF waits at least 30 seconds between retries`,
    );
  return [...problems, ...dependencyLimits(trigger, named)];
}

function dependencyLimits(trigger: ResolvedTrigger, named: string): string[] {
  const dependencies = trigger.depends_on ?? [];
  const problems: string[] = [];
  if (dependencies.length > 5)
    problems.push(`${named} depends on ${dependencies.length} triggers; ADF allows at most 5`);
  const unordered = dependencies.some(
    (item) => onItself(trigger, item) && !((durationMs(item.offset ?? "0s") ?? 0) < 0),
  );
  if (unordered)
    problems.push(
      `${named} depends on itself, which ADF allows only with a negative offset, such as -1h`,
    );
  return problems;
}

function timeLimits(trigger: ResolvedTrigger, named: string): string[] {
  if (!windowsZone(trigger.timezone))
    return [
      `${named} uses the time zone ${trigger.timezone}, which has no Windows time zone name, so ADF cannot schedule it`,
    ];
  if (trigger.end === undefined) return [];
  const [start, end] = [trigger.start, trigger.end].map((text) =>
    instantOf(text, trigger.timezone),
  );
  if (start === undefined || end === undefined || end > start) return [];
  return [`${named} ends at ${trigger.end}, which is not after its start, ${trigger.start}`];
}

/**
 * What ADF refuses in one trigger, each message naming the trigger and the limit: refinements
 * on the wrong frequency, the interval, a tumbling window's size, concurrency, retries and
 * dependencies, an end not after the start, and a zone with no Windows name.
 * @example triggerLimits(trigger) // ['The trigger "b/x" has concurrency 51; ADF allows 1 to 50']
 */
export function triggerLimits(trigger: ResolvedTrigger): string[] {
  const named = `The trigger "${trigger.flow}/${trigger.name}"`;
  const { interval } = trigger.every;
  return [
    ...(trigger.type === "schedule"
      ? scheduleLimits(trigger, named)
      : windowLimits(trigger, named)),
    ...(interval < 1 || interval > 1000
      ? [`${named} has interval ${interval}; ADF allows 1 to 1000`]
      : []),
    ...timeLimits(trigger, named),
  ];
}

/** A second tumbling window on the flow's pipeline, which would load each window twice. */
function secondWindow(flow: string, triggers: ResolvedTrigger[]): string[] {
  const windows = triggers.filter((trigger) => trigger.type === "tumbling-window");
  if (windows.length < 2) return [];
  return [
    `The flow "${flow}" has two tumbling-window triggers, "${windows[0]!.name}" and "${windows[1]!.name}", on one pipeline; ADF would load each window twice. Keep one`,
  ];
}

/**
 * The concurrency and retry interval a tumbling window takes from the standard's `operations`
 * when it writes none, held to the limits its own would be.
 */
function defaultLimits(model: ResolvedModel, trigger: ResolvedTrigger): string[] {
  if (trigger.type !== "tumbling-window") return [];
  const named = `The trigger "${trigger.flow}/${trigger.name}"`;
  const runs = trigger.concurrency === undefined ? model.operations.concurrency?.max_runs : 1;
  const retries = trigger.retries === undefined ? model.operations.retries : undefined;
  return [
    ...(runs !== undefined && (runs < 1 || runs > 50)
      ? [
          `${named} takes concurrency ${runs} from the standard's \`operations.concurrency.max_runs\`; ADF allows 1 to 50`,
        ]
      : []),
    ...retryDefault(named, retries),
  ];
}

/** The retry interval a tumbling window takes from the standard, when it is under 30 seconds. */
function retryDefault(named: string, retries?: { interval: string }): string[] {
  const interval = retries && durationMs(retries.interval);
  if (interval === undefined || interval >= 30_000) return [];
  return [
    `${named} takes the retry interval ${retries!.interval} from the standard's \`operations.retries\`; ADF waits at least 30 seconds between retries`,
  ];
}

/** What ADF refuses in the triggers flows write, once for each flow. */
export function flowTriggerProblems(model: ResolvedModel): string[] {
  const flows = new Map<string, ResolvedTrigger[]>();
  for (const table of model.tables) {
    const triggers = table.ingest?.triggers ?? [];
    if (table.ingest?.pack === "adf" && triggers.length > 0) flows.set(triggers[0]!.flow, triggers);
  }
  return [...flows].flatMap(([flow, triggers]) => [
    ...triggers.flatMap((trigger) => [...triggerLimits(trigger), ...defaultLimits(model, trigger)]),
    ...secondWindow(flow, triggers),
  ]);
}
