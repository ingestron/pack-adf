// The backfill rule: a tumbling window a flow writes, new and starting in the past, would
// make ADF run every window since its start, so it is refused unless the engineer confirms it.
import { utcText } from "./times.js";

/** Marks a tumbling window a flow writes; the default triggers carry no annotation. */
export const flowAnnotation = "ingestron:flow-trigger";

/** Confirms that a flow's tumbling window may run its past windows (`backfill: true`). */
export const backfillAnnotation = "ingestron:backfill";

const MINUTE = 60_000;
const lengths: Record<string, number> = { Minute: MINUTE, Hour: 60 * MINUTE };

/** `start` and `months` later, UTC, keeping to the last day of a shorter month. */
function addMonths(start: number, months: number): number {
  const at = new Date(start);
  const first = Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + months, 1);
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  return (
    first + (Math.min(at.getUTCDate(), last.getUTCDate()) - 1) * 86_400_000 + (start % 86_400_000)
  );
}

/**
 * How many windows of a tumbling window have ended between `start` and `now`, in UTC: the
 * windows ADF would run at once for a trigger that starts in the past. Zero before `start`.
 * @example pastWindows("Hour", 1, start, start + 24 * 3_600_000) // 24
 */
export function pastWindows(
  frequency: string,
  interval: number,
  start: number,
  now: number,
): number {
  if (now <= start) return 0;
  if (frequency !== "Month") {
    const length = (lengths[frequency] ?? MINUTE) * interval;
    return Math.floor((now - start) / length);
  }
  let count = 0;
  while (addMonths(start, (count + 1) * interval) <= now) count += 1;
  return count;
}

interface Written {
  name?: string;
  properties?: {
    type?: string;
    annotations?: string[];
    typeProperties?: { frequency?: string; interval?: number; startTime?: string };
  };
}

/** The trigger a file holds; undefined when it is not JSON or not an object. */
function read(text: string): Written | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? (value as Written) : undefined;
  } catch {
    return undefined;
  }
}

/** True for a tumbling window a flow wrote that does not confirm its backfill. */
function unconfirmed(trigger: Written): boolean {
  const { type, annotations = [] } = trigger.properties ?? {};
  return (
    type === "TumblingWindowTrigger" &&
    annotations.includes(flowAnnotation) &&
    !annotations.includes(backfillAnnotation)
  );
}

/** The message for a flow's tumbling window that is new and starts in the past, if it does. */
function refusal(trigger: Written, now: Date): string | undefined {
  const { startTime, frequency = "", interval = 1 } = trigger.properties?.typeProperties ?? {};
  const start = Date.parse(startTime ?? "");
  if (!unconfirmed(trigger) || !(start < now.getTime())) return undefined;
  const count = pastWindows(frequency, interval, start, now.getTime());
  if (count === 0) return undefined;
  return `${trigger.name} is new and starts at ${utcText(start)}: ADF would run ${count} past windows again. Move \`start\` to now or later, or write \`backfill: true\` on the trigger.`;
}

/**
 * The flow tumbling windows among `files` that are new (their path is not in `generatedBefore`),
 * start before `now`, and are not confirmed with `backfill: true`. A file is a trigger when
 * a `trigger/` folder holds it, wherever that folder is.
 * @example checkBackfill(files, new Set(), new Date())
 */
export function checkBackfill(
  files: Readonly<Record<string, string>>,
  generatedBefore: ReadonlySet<string>,
  now: Date,
): string[] {
  return Object.entries(files).flatMap(([path, text]) => {
    if (generatedBefore.has(path) || !/(^|\/)trigger\/[^/]+\.json$/.test(path)) return [];
    const trigger = read(text);
    const message = trigger && refusal(trigger, now);
    return message ? [message] : [];
  });
}
