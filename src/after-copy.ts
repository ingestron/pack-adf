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
  const used = new Map<string, number>();
  for (const triggers of scheduleGroups(files).values()) {
    const { frequency, interval } = triggers[0]!.properties.typeProperties;
    const base = `${model.project.id}_every_${interval}_${frequency.toLowerCase()}`;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    const suffix = count > 1 ? `_${count}` : "";
    const children = triggers.map(
      (item) => item.properties.pipeline.pipelineReference.referenceName,
    );
    for (const [index, child] of children.entries())
      retryCopies(files, child, triggers[index]!.properties.typeProperties.retryPolicy);
    const pipeline = `pl_${base}${suffix}`;
    files[`pipeline/${pipeline}.json`] = text(parentPipeline(pipeline, children.sort(), job));
    const trigger = parentTrigger(triggers[0]!, `tr_${base}${suffix}`, pipeline);
    files[`trigger/${trigger.name}.json`] = text(trigger);
  }
}

/** Every trigger, removed from the files and grouped by its window settings and state. */
function scheduleGroups(files: Record<string, string>): Map<string, Trigger[]> {
  const groups = new Map<string, Trigger[]>();
  for (const path of Object.keys(files).filter((key) => key.startsWith("trigger/"))) {
    const trigger = JSON.parse(files[path]!) as Trigger;
    const key = JSON.stringify([
      trigger.properties.typeProperties,
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
