// With after_copy, a trigger a flow writes keeps its name and settings, so its windows,
// dependencies and backfill stay its own, but starts a parent pipeline of its own: it runs the
// flow's pipeline with the trigger's values, then the job. A tumbling window's retries move onto
// the copies, as the default trigger's do.
import { parentPipeline } from "./after-copy-activities.js";

type Data = Record<string, unknown>;
type Retry = { count: number; intervalInSeconds: number };

/** A pipeline a trigger starts, with the values it passes. */
interface Run {
  pipelineReference: { referenceName: string } & Data;
  parameters?: Data;
}

/** A trigger a flow writes: a tumbling window starts `pipeline`, a schedule `pipelines`. */
interface FlowTrigger {
  name: string;
  properties: {
    typeProperties: { retryPolicy?: Retry } & Data;
    pipeline?: Run;
    pipelines?: Run[];
  } & Data;
}

/** A resource as the pack writes its file. */
export const text = (resource: unknown): string => `${JSON.stringify(resource, null, "\t")}\n`;

/** The trigger's retries move onto the connection pipeline's copies. */
export function retryCopies(files: Record<string, string>, child: string, retry: Retry): void {
  const path = `pipeline/${child}.json`;
  const pipeline = JSON.parse(files[path]!) as { properties: { activities: Data[] } };
  // The team's own activity policy wins; Copy activities in a ForEach count too.
  const nested = (item: Data) =>
    item.type === "ForEach"
      ? ((item.typeProperties as { activities: Data[] }).activities ?? [])
      : [item];
  for (const activity of pipeline.properties.activities.flatMap(nested))
    if (activity.type === "Copy")
      activity.policy = {
        retry: retry.count,
        retryIntervalInSeconds: retry.intervalInSeconds,
        ...(activity.policy as Data | undefined),
      };
  files[path] = text(pipeline);
}

/** What the parent declares: each value the trigger passes, declared as the flow's pipeline does. */
function declarations(files: Record<string, string>, child: string, passed: Data): Data {
  const pipeline = JSON.parse(files[`pipeline/${child}.json`] ?? "{}") as {
    properties?: { parameters?: Data };
  };
  const declared = pipeline.properties?.parameters ?? {};
  return Object.fromEntries(
    Object.keys(passed).map((name) => [name, declared[name] ?? { type: "String" }]),
  );
}

/** The trigger, now starting `parent` with the same values, its retries left to the copies. */
function pointed(trigger: FlowTrigger, parent: string): FlowTrigger {
  const properties = trigger.properties;
  const to = (run: Run): Run => ({
    ...run,
    pipelineReference: { ...run.pipelineReference, referenceName: parent },
  });
  const retry = properties.typeProperties.retryPolicy;
  if (retry) properties.typeProperties.retryPolicy = { ...retry, count: 0 };
  if (properties.pipeline) properties.pipeline = to(properties.pipeline);
  if (properties.pipelines) properties.pipelines = properties.pipelines.slice(0, 1).map(to);
  return trigger;
}

/**
 * For each trigger named in `names`, a parent pipeline `pl_<trigger name without tr_>` that runs
 * the pipelines the trigger starts, passing on its values, then the job; the trigger starts it.
 */
export function flowParents(
  files: Record<string, string>,
  job: { job: string; timeout: string },
  names: ReadonlySet<string>,
): void {
  for (const name of [...names].sort()) {
    const path = `trigger/${name}.json`;
    const trigger = JSON.parse(files[path]!) as FlowTrigger;
    const { pipeline, pipelines, typeProperties } = trigger.properties;
    const runs = pipeline ? [pipeline] : (pipelines ?? []);
    const children = runs.map((run) => run.pipelineReference.referenceName);
    const parent = `pl_${name.replace(/^tr_/, "")}`;
    if (files[`pipeline/${parent}.json`])
      throw new Error(
        `after_copy's parent pipeline "${parent}" has the name of a generated pipeline; rename that pipeline with resource_names.pipeline`,
      );
    const passed = declarations(files, children[0]!, runs[0]?.parameters ?? {});
    files[`pipeline/${parent}.json`] = text(parentPipeline(parent, children, job, passed));
    if (typeProperties.retryPolicy)
      for (const child of children) retryCopies(files, child, typeProperties.retryPolicy);
    files[path] = text(pointed(trigger, parent));
  }
}
