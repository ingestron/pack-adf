// A tumbling-window trigger a flow writes: fixed windows in UTC, each passed to the flow's
// pipeline, with the standard's operations as defaults for concurrency and retries.
import type { ResolvedModel, ResolvedTrigger, TriggerDependency } from "@ingestron/definitions";
import { reference } from "../resources/index.js";
import { flowSettings, runtimeState, triggerParameters } from "./schedule-trigger.js";
import { backfillAnnotation, flowAnnotation } from "./backfill.js";
import { instantOf, seconds, timespan, utcText } from "./times.js";

type Data = Record<string, unknown>;

/** The flow and name a dependency on another trigger means: `<flow>/<name>`. */
export function dependencyKey(trigger: ResolvedTrigger, named: string): string {
  return named.includes("/") ? named : `${trigger.flow}/${named}`;
}

/** True when a dependency is on the trigger itself, as `self: true` or by its own name. */
export function onItself(trigger: ResolvedTrigger, dependency: TriggerDependency): boolean {
  if ("self" in dependency) return true;
  return dependencyKey(trigger, dependency.trigger) === `${trigger.flow}/${trigger.name}`;
}

/**
 * The dependencies of a tumbling window, as `<flow>/<name>`, on windows that `names` does not
 * hold: windows this pack does not write, such as another pack's in a mixed project.
 */
export function unnamedDependencies(
  trigger: ResolvedTrigger,
  names: { has(key: string): boolean },
): string[] {
  return (trigger.depends_on ?? [])
    .filter((item) => !onItself(trigger, item))
    .map((item) => dependencyKey(trigger, (item as { trigger: string }).trigger))
    .filter((key) => !names.has(key));
}

/** One `dependsOn` entry; a dependency on itself by name is written as a self-dependency. */
function dependencyOf(
  trigger: ResolvedTrigger,
  dependency: TriggerDependency,
  names: ReadonlyMap<string, string>,
): Data {
  const sized = {
    ...(dependency.size !== undefined && { size: timespan(dependency.size) }),
    ...(dependency.offset !== undefined && { offset: timespan(dependency.offset) }),
  };
  if (onItself(trigger, dependency))
    return { type: "SelfDependencyTumblingWindowTriggerReference", ...sized };
  const key = dependencyKey(trigger, (dependency as { trigger: string }).trigger);
  return {
    type: "TumblingWindowTriggerDependencyReference",
    ...sized,
    // The pack's check refuses a dependency `names` lacks, and no such trigger is written.
    referenceTrigger: { referenceName: names.get(key)!, type: "TriggerReference" },
  };
}

/** The trigger's retries, else the standard's, else the method's count every 300 seconds. */
function retryPolicy(model: ResolvedModel, trigger: ResolvedTrigger, settings: Data): Data {
  const retries = trigger.retries ?? model.operations.retries;
  if (!retries) return { count: settings.retries ?? 2, intervalInSeconds: 300 };
  return { count: retries.count, intervalInSeconds: seconds(retries.interval) ?? 300 };
}

/** A time as written, in UTC; as written when it cannot be read. */
function inUtc(text: string, zone: string): string {
  const at = instantOf(text, zone);
  return at === undefined ? text : utcText(at);
}

/**
 * A TumblingWindowTrigger for one trigger a flow writes, passing each window to `pipeline`.
 * `names` gives the generated name of each tumbling window by `<flow>/<name>`, for `dependsOn`.
 * @example tumblingTrigger(model, trigger, "pl_erp_erp_b", "tr_erp_erp_b_hourly_h1", names)
 */
export function tumblingTrigger(
  model: ResolvedModel,
  trigger: ResolvedTrigger,
  pipeline: string,
  name: string,
  names: ReadonlyMap<string, string>,
): Data {
  const settings = flowSettings(model, trigger.flow);
  const typeProperties: Data = {
    frequency: trigger.every.frequency,
    interval: trigger.every.interval,
    startTime: inUtc(trigger.start, trigger.timezone),
    ...(trigger.end !== undefined && { endTime: inUtc(trigger.end, trigger.timezone) }),
    ...(trigger.delay !== undefined && { delay: timespan(trigger.delay) }),
    maxConcurrency: trigger.concurrency ?? model.operations.concurrency?.max_runs ?? 1,
    retryPolicy: retryPolicy(model, trigger, settings),
    ...(trigger.depends_on && {
      dependsOn: trigger.depends_on.map((item) => dependencyOf(trigger, item, names)),
    }),
  };
  return {
    name,
    properties: {
      type: "TumblingWindowTrigger",
      runtimeState: runtimeState(model, trigger),
      // Marks a flow's trigger for the backfill check; the default triggers have no annotations.
      annotations: [flowAnnotation, ...(trigger.backfill ? [backfillAnnotation] : [])],
      typeProperties,
      pipeline: {
        pipelineReference: reference(pipeline, "PipelineReference"),
        parameters: {
          windowStart: "@trigger().outputs.windowStartTime",
          windowEnd: "@trigger().outputs.windowEndTime",
          ...triggerParameters(trigger),
        },
      },
    },
  };
}
