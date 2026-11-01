// With after_copy, each schedule's copies run from one parent pipeline, which
// then starts the Container Apps job and waits for it. The connection
// pipelines lose their triggers, and a failed copy is retried in place, so a
// retry never copies the schedule again or starts the job twice.
import type { ResolvedModel } from "@ingestron/definitions";
import { parentPipeline } from "./after-copy-activities.js";
import { afterCopyOf } from "./after-copy-settings.js";

type Data = Record<string, unknown>;
interface Trigger {
  name: string;
  properties: {
    runtimeState: string;
    typeProperties: {
      frequency: string;
      interval: number;
      retryPolicy: { count: number; intervalInSeconds: number };
    } & Data;
    pipeline: { pipelineReference: { referenceName: string } } & Data;
  } & Data;
}

/** Replaces the connection pipelines' triggers with one parent pipeline and trigger per schedule. */
export function afterCopy(files: Record<string, string>, model: ResolvedModel): void {
  const job = afterCopyOf(model);
  if (!job) return;
  // Started schedules first, then by start, so the plain name goes to the earliest started one.
  const groups = [...scheduleGroups(files).values()].sort(
    (a, b) => Number(stopped(a[0]!)) - Number(stopped(b[0]!)) || startOf(a[0]!) - startOf(b[0]!),
  );
  const used = new Set<string>();
  const firsts = new Map<string, Trigger>();
  for (const triggers of groups) {
    const name = parentName(model.project.id, triggers[0]!, firsts, used);
    used.add(name);
    const children = triggers.map(
      (item) => item.properties.pipeline.pipelineReference.referenceName,
    );
    for (const [index, child] of children.entries())
      retryCopies(files, child, triggers[index]!.properties.typeProperties.retryPolicy);
    const pipeline = `pl_${name}`;
    if (files[`pipeline/${pipeline}.json`])
      throw new Error(
        `after_copy's parent pipeline "${pipeline}" has the name of a generated pipeline; rename that pipeline with resource_names.pipeline`,
      );
    files[`pipeline/${pipeline}.json`] = text(parentPipeline(pipeline, children.sort(), job));
    const trigger = parentTrigger(triggers[0]!, `tr_${name}`, pipeline);
    files[`trigger/${trigger.name}.json`] = text(trigger);
  }
}

const startOf = (trigger: Trigger) =>
  Date.parse(String(trigger.properties.typeProperties.startTime));
const stopped = (trigger: Trigger) => trigger.properties.runtimeState === "Stopped";

/**
 * `<project>_every_<interval>_<unit>` for the first schedule of that size;
 * another is named by what differs from that one: `_from_<yyyyMMdd>` (with
 * `HHmm`, or `HHmmss` when seconds are set) for a different start, then
 * `_stopped` when it is stopped and that one is not; a counter only if that is
 * still taken.
 */
function parentName(
  project: string,
  trigger: Trigger,
  firsts: Map<string, Trigger>,
  used: Set<string>,
): string {
  const { frequency, interval } = trigger.properties.typeProperties;
  const base = `${project}_every_${interval}_${frequency.toLowerCase()}`;
  const first = firsts.get(base);
  if (!first) {
    firsts.set(base, trigger);
    return base;
  }
  const start = startOf(trigger);
  const from = start === startOf(first) ? "" : `_from_${stamp(start)}`;
  const state = stopped(trigger) && !stopped(first) ? "_stopped" : "";
  const name = `${base}${from}${state}`;
  if (!used.has(name)) return name;
  let count = 2;
  while (used.has(`${name}_${count}`)) count += 1;
  return `${name}_${count}`;
}

/** A start as yyyyMMdd, then HHmm when not midnight, or HHmmss when it has seconds (UTC). */
function stamp(time: number): string {
  const iso = new Date(time).toISOString();
  const date = iso.slice(0, 10).replaceAll("-", "");
  const clock = iso.slice(11, 19).replaceAll(":", "");
  if (clock.endsWith("00")) return clock === "000000" ? date : `${date}${clock.slice(0, 4)}`;
  return `${date}${clock}`;
}

/** Every trigger, removed from the files and grouped by its window settings and state. */
function scheduleGroups(files: Record<string, string>): Map<string, Trigger[]> {
  const groups = new Map<string, Trigger[]>();
  for (const path of Object.keys(files).filter((key) => key.startsWith("trigger/"))) {
    const trigger = JSON.parse(files[path]!) as Trigger;
    // Retries move onto each pipeline's copies, so they do not split a schedule.
    const key = JSON.stringify([
      { ...trigger.properties.typeProperties, retryPolicy: undefined },
      trigger.properties.runtimeState,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), trigger]);
    delete files[path];
  }
  return groups;
}

/** The trigger's retries move onto the connection pipeline's copies. */
function retryCopies(
  files: Record<string, string>,
  child: string,
  retry: { count: number; intervalInSeconds: number },
): void {
  const path = `pipeline/${child}.json`;
  const pipeline = JSON.parse(files[path]!) as { properties: { activities: Data[] } };
  for (const activity of pipeline.properties.activities.filter((item) => item.type === "Copy"))
    activity.policy = {
      ...(activity.policy as Data | undefined),
      retry: retry.count,
      retryIntervalInSeconds: retry.intervalInSeconds,
    };
  files[path] = text(pipeline);
}

const text = (resource: unknown) => `${JSON.stringify(resource, null, "\t")}\n`;

function parentTrigger(first: Trigger, name: string, pipeline: string): Trigger {
  const { pipelineReference } = first.properties.pipeline;
  const { typeProperties } = first.properties;
  return {
    ...first,
    name,
    properties: {
      ...first.properties,
      typeProperties: {
        ...typeProperties,
        retryPolicy: { ...typeProperties.retryPolicy, count: 0 },
      },
      pipeline: {
        ...first.properties.pipeline,
        pipelineReference: { ...pipelineReference, referenceName: pipeline },
      },
    },
  };
}
