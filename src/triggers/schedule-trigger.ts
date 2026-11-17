// A schedule trigger a flow writes: a recurrence in the trigger's zone, starting the flow's
// pipeline with the trigger's parameter values.
import type { ResolvedModel, ResolvedTrigger, ScheduleAt } from "@ingestron/definitions";
import { plainValue } from "../design/index.js";
import { paused, reference } from "../resources/index.js";
import { durationMs, readTime, utcText, wallText, windowsZone } from "./times.js";

type Data = Record<string, unknown>;

/**
 * The values a trigger gives its pipeline: a literal as it is, escaped where ADF would read it as
 * an expression, and an expression as an Expression.
 */
export function triggerParameters(trigger: ResolvedTrigger): Data {
  return Object.fromEntries(
    Object.entries(trigger.parameters).map(([name, value]) => [
      name,
      typeof value === "object"
        ? { type: "Expression", value: value.expression }
        : plainValue(value),
    ]),
  );
}

/**
 * The window a schedule gives its pipeline: from the lookback before the scheduled time up to it,
 * so a run reads back over the last one; both the scheduled time for a full run (`load: full`) and
 * for a trigger with no lookback, which then records when the run happened. A lookback that is
 * not whole minutes rounds up, so it still covers what it was written to.
 */
export function scheduleWindow(trigger: ResolvedTrigger): Data {
  const scheduled = "@trigger().scheduledTime";
  const length = trigger.lookback === undefined ? undefined : durationMs(trigger.lookback);
  if (trigger.parameters.load === "full" || length === undefined)
    return { windowStart: scheduled, windowEnd: scheduled };
  const minutes = Math.ceil(length / 60_000);
  return {
    windowStart: `@formatDateTime(addMinutes(trigger().scheduledTime, -${minutes}), 'yyyy-MM-ddTHH:mm:ssZ')`,
    windowEnd: scheduled,
  };
}

/** What a schedule passes its pipeline: the window, then the trigger's own values. */
export function scheduleParameters(trigger: ResolvedTrigger): Data {
  return { ...scheduleWindow(trigger), ...triggerParameters(trigger) };
}

/** The ingest settings of the flow's tables, which share its pipeline. */
export function flowSettings(model: ResolvedModel, flow: string): Data {
  const table = model.tables.find(
    (item) => item.origin.kind === "Flow" && item.origin.id === flow && item.ingest,
  );
  return table?.ingest?.settings ?? {};
}

/** `Stopped` when the trigger is paused, else when the flow's tables' settings or the environment say so. */
export function runtimeState(model: ResolvedModel, trigger: ResolvedTrigger): string {
  if (trigger.paused) return "Stopped";
  return paused(model, flowSettings(model, trigger.flow)) ? "Stopped" : "Started";
}

/**
 * A time as written: in UTC with `Z` when the zone is UTC, else the zone's wall-clock time,
 * as written when it has no offset; as written when it cannot be read.
 */
function zoned(text: string, zone: string, windows: string | undefined): string {
  const read = readTime(text, zone);
  if (read === undefined) return text;
  return windows === "UTC" ? utcText(read.instant) : wallText(read.wall);
}

/** The recurrence's `schedule`, from the largest refinement to the smallest; undefined when none. */
function scheduleOf(at?: ScheduleAt): Data | undefined {
  if (!at) return undefined;
  const schedule: Data = {
    ...(at.weekdays && { weekDays: at.weekdays }),
    ...(at.month_days && { monthDays: at.month_days }),
    ...(at.occurrences && { monthlyOccurrences: at.occurrences }),
    ...(at.hours && { hours: at.hours }),
    ...(at.minutes && { minutes: at.minutes }),
  };
  return Object.keys(schedule).length > 0 ? schedule : undefined;
}

/**
 * A ScheduleTrigger for one trigger a flow writes, starting each pipeline with its parameters.
 * Its times are in the trigger's zone, by its Windows name: UTC with `Z`, others as local times.
 * @example scheduleTrigger(model, trigger, [{ name: "pl_erp_erp_b", parameters: { load: "full" } }], "tr_erp_erp_b_weekly-reload")
 */
export function scheduleTrigger(
  model: ResolvedModel,
  trigger: ResolvedTrigger,
  pipelines: { name: string; parameters: Record<string, unknown> }[],
  name: string,
): Data {
  const windows = windowsZone(trigger.timezone);
  const schedule = scheduleOf(trigger.at);
  const recurrence: Data = {
    frequency: trigger.every.frequency,
    interval: trigger.every.interval,
    startTime: zoned(trigger.start, trigger.timezone, windows),
    ...(trigger.end !== undefined && { endTime: zoned(trigger.end, trigger.timezone, windows) }),
    timeZone: windows ?? trigger.timezone,
    ...(schedule && { schedule }),
  };
  return {
    name,
    properties: {
      type: "ScheduleTrigger",
      runtimeState: runtimeState(model, trigger),
      typeProperties: { recurrence },
      pipelines: pipelines.map((pipeline) => ({
        pipelineReference: reference(pipeline.name, "PipelineReference"),
        parameters: pipeline.parameters,
      })),
    },
  };
}
