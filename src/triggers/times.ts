// Times and durations as ADF writes them: the Windows name of a zone, a start in UTC or in a
// zone's local time, and durations as seconds or as a timespan.
import { clockOf, readStart } from "@ingestron/definitions";
import { windowsZones } from "./windows-zones.js";

/** Each IANA zone name, with its Windows zone. */
const windowsNames: ReadonlyMap<string, string> = new Map(
  Object.entries(windowsZones).flatMap(([windows, names]) =>
    names.split(" ").map((name) => [name, windows] as const),
  ),
);

/**
 * The Windows time zone ADF uses for an IANA zone name, from the Unicode CLDR's mapping;
 * undefined for a zone it has none for.
 * @example windowsZone("Europe/London") // "GMT Standard Time"
 */
export function windowsZone(iana: string): string | undefined {
  return windowsNames.get(iana);
}

const SECOND = 1000;
const units = { s: SECOND, m: 60 * SECOND, h: 3600 * SECOND, d: 86_400 * SECOND } as const;

/** The length of a duration such as `5m` or `-1h` in milliseconds; undefined when it is not one. */
export function durationMs(text: string): number | undefined {
  const match = /^(-?)([0-9]+)([smhd])$/.exec(text);
  if (!match) return undefined;
  const [, sign, count, unit] = match;
  return (sign ? -1 : 1) * Number(count) * units[unit as keyof typeof units];
}

/** A duration as ADF's timespan, `[-][d.]hh:mm:ss`, such as `-01:00:00` for `-1h`. */
export function timespan(text: string): string {
  const length = durationMs(text);
  if (length === undefined) return text;
  const seconds = Math.abs(length) / SECOND;
  const days = Math.floor(seconds / 86_400);
  const clock = [3600, 60, 1].map((size, index) => {
    const value = index === 0 ? Math.floor(seconds / size) % 24 : Math.floor(seconds / size) % 60;
    return String(value).padStart(2, "0");
  });
  return `${length < 0 ? "-" : ""}${days > 0 ? `${days}.` : ""}${clock.join(":")}`;
}

/** A duration in whole seconds, such as 300 for `5m`. */
export function seconds(text: string): number | undefined {
  const length = durationMs(text);
  return length === undefined ? undefined : Math.round(length / SECOND);
}

/** A start or end as written, as an instant and as the zone's wall-clock time; undefined if unread. */
export function readTime(
  text: string,
  zone: string,
): { instant: number; wall: number } | undefined {
  try {
    return readStart(text, clockOf(zone));
  } catch {
    return undefined;
  }
}

/** The instant a written date-time stands for, read as definitions reads a trigger's start. */
export function instantOf(text: string, zone: string): number | undefined {
  return readTime(text, zone)?.instant;
}

/** `yyyy-MM-ddTHH:mm:ssZ`, as ADF writes a time in UTC. */
export function utcText(at: number): string {
  return `${new Date(at).toISOString().slice(0, 19)}Z`;
}

/** `yyyy-MM-ddTHH:mm:ss`, a wall-clock time (read as UTC), as ADF writes a time in another zone. */
export function wallText(wall: number): string {
  return new Date(wall).toISOString().slice(0, 19);
}
