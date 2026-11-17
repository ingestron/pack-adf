// The names of the triggers flows write, and the files they become.
import type { ResolvedModel, ResolvedTrigger } from "@ingestron/definitions";
import { scheduleParameters, scheduleTrigger } from "./schedule-trigger.js";
import { tumblingTrigger, unnamedDependencies } from "./tumbling-trigger.js";

/** A tumbling window's frequency in its name: ADF cannot edit a published one's size. */
const units: Record<string, string> = { Minute: "m", Hour: "h", Day: "d", Week: "w", Month: "mo" };

/**
 * `tr_<pipeline>_<name>`, where `<pipeline>` is the pipeline's name without `pl_`. A tumbling
 * window adds its size, such as `_h1`, so a change of frequency or interval is a new trigger
 * rather than an edit ADF refuses.
 * @example triggerName("pl_erp_erp_b", hourly) // "tr_erp_erp_b_hourly_h1"
 */
export function triggerName(pipeline: string, trigger: ResolvedTrigger): string {
  const base = `tr_${pipeline.replace(/^pl_/, "")}_${trigger.name}`;
  if (trigger.type !== "tumbling-window") return base;
  return `${base}_${units[trigger.every.frequency]}${trigger.every.interval}`;
}

/** A flow's own pipeline and the triggers that start it. */
export interface FlowPipeline {
  pipeline: string;
  triggers: ResolvedTrigger[];
}

/**
 * Adds a trigger resource for each trigger of each flow pipeline, and returns their names.
 * A tumbling window's dependency on another names that trigger's generated name; one that
 * depends on a window no flow pipeline has is not written (the pack's check refuses it).
 */
export function addFlowTriggers(
  model: ResolvedModel,
  pipelines: FlowPipeline[],
  add: (folder: string, resource: { name?: unknown }) => void,
): Set<string> {
  const names = new Map<string, string>();
  for (const { pipeline, triggers } of pipelines)
    for (const trigger of triggers) {
      const key = `${trigger.flow}/${trigger.name}`;
      if (!names.has(key)) names.set(key, triggerName(pipeline, trigger));
    }
  const written = new Set<string>();
  for (const { pipeline, triggers } of pipelines)
    for (const trigger of triggers) {
      if (unnamedDependencies(trigger, names).length > 0) continue;
      const name = triggerName(pipeline, trigger);
      written.add(name);
      add(
        "trigger",
        trigger.type === "tumbling-window"
          ? tumblingTrigger(model, trigger, pipeline, name, names)
          : scheduleTrigger(
              model,
              trigger,
              [{ name: pipeline, parameters: scheduleParameters(trigger) }],
              name,
            ),
      );
    }
  return written;
}
