// The Data Factory triggers' state, for `ingestron request`, read from the
// trigger files the pack generates so the two always agree.
import type { RequestSection, ResolvedModel } from "@ingestron/definitions";
import { prerequisites } from "./prerequisites.js";
import { build } from "./build.js";

interface Trigger {
  name: string;
  properties: { runtimeState: string; typeProperties: { frequency: string; interval: number } };
}

/** The Data Factory section of the platform request: one line per trigger. */
export function request(model: ResolvedModel): RequestSection[] {
  const triggers = Object.entries(build(model))
    .filter(([path]) => path.startsWith("trigger/"))
    .map(([, text]) => JSON.parse(text) as Trigger);
  if (triggers.length === 0) return [];
  return [{ title: "Schedules", lines: triggers.map(line) }, ...prerequisites(model)];
}

function line({ name, properties }: Trigger): string {
  const { frequency, interval } = properties.typeProperties;
  const unit = frequency.toLowerCase();
  const every = interval === 1 ? unit : `${interval} ${unit}s`;
  const state = properties.runtimeState === "Started" ? "started" : "stopped";
  return `Data Factory trigger \`${name}\`: every ${every}, ${state}.`;
}
