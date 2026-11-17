// The standard's trigger rules applied to the default trigger, the tumbling window a group of
// tables gets from its method settings when its flow writes no triggers of its own.
import {
  clockTime,
  outsideHours,
  type ResolvedModel,
  type ResolvedTrigger,
} from "@ingestron/definitions";
import { resourceName } from "../factory/index.js";
import { flowSuffix, flowTriggers } from "./groups.js";
import { copyGroups, copyName, filesGroups } from "./source-groups.js";
import { tableGroups } from "./table-resources.js";
import type { ResolvedTable } from "@ingestron/definitions";

/** Each group the default trigger starts, with the name of that trigger. */
function defaultGroups(model: ResolvedModel): { name: string; tables: ResolvedTable[] }[] {
  const project = model.project.id;
  const named = (tables: ResolvedTable[], base: string) => ({
    name: resourceName(tables, "trigger", `tr_${base}${flowSuffix(tables)}`),
    tables,
  });
  return [
    ...copyGroups(model).map((group) => named(group.tables, copyName(project, group))),
    ...filesGroups(model).map((group) => named(group.tables, `${project}_${group.connection.id}`)),
    ...tableGroups(model).map((tables) =>
      named(tables, `${project}_${tables[0]!.ingest!.connection.id}`),
    ),
  ].filter((group) => flowTriggers(group.tables).length === 0);
}

/** The default trigger as a trigger a flow could write: a tumbling window in UTC, no parameters. */
function asTrigger(name: string, settings: Record<string, unknown>): ResolvedTrigger {
  const every = settings.every as ResolvedTrigger["every"];
  return {
    flow: "",
    name,
    type: "tumbling-window",
    every,
    start: String(settings.start),
    timezone: "UTC",
    retries: { count: Number(settings.retries ?? 2), interval: "300s" },
    parameters: {},
    // Not written in any document; outsideHours does not read it.
    at_source: undefined as never,
  };
}

/**
 * The default triggers that break the standard's `operations.triggers`: a type it does not
 * allow, or a run start outside its hours, in the words definitions uses for a flow's triggers.
 * This is the only part of the pack's check that reads `operations.triggers`. The Synapse pack
 * calls the check with that policy opened up (any hour, and tumbling windows allowed), because
 * its default trigger is a schedule it judges itself; a new check here that reads the policy
 * would be silenced for Synapse, and needs its own counterpart there.
 */
export function defaultTriggerProblems(model: ResolvedModel): string[] {
  const { types, hours } = model.operations.triggers;
  if (types.includes("tumbling-window") && !hours) return [];
  return defaultGroups(model).flatMap(({ name, tables }) => {
    const problems: string[] = [];
    if (!types.includes("tumbling-window"))
      problems.push(
        `The standard allows only ${types.join(" and ")} triggers. The default trigger "${name}" is a tumbling-window trigger; write the flow's own triggers, or ask for tumbling-window in the standard's \`operations.triggers.types\``,
      );
    const found = hours && outsideHours(asTrigger(name, tables[0]!.ingest!.settings), hours);
    if (hours && found)
      problems.push(
        `"${name}" starts a run at ${clockTime(found, hours.timezone)} (${hours.timezone}), outside the hours the standard allows here: ${hours.from}–${hours.to}`,
      );
    return problems;
  });
}
