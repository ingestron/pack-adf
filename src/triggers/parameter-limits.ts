// What the pack refuses in a flow's parameters before anything is generated: a date that is not
// on the calendar, and a filter that reads `load` when no trigger sets it.
import {
  parameterReferences,
  type ParameterDef,
  type ResolvedModel,
  type ResolvedTable,
} from "@ingestron/definitions";
import { setsLoad } from "../design/index.js";
import { flowScopeProblems } from "./flow-scope.js";
import { flowTriggerProblems } from "./limits.js";

const date = /^(\d{4})-(\d{2})-(\d{2})$/;
const datetime = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

/** True when the text is a day on the calendar, such as 2026-02-28 but not 2026-02-30. */
function realDay(text: string): boolean {
  const [, year, month, day] = date.exec(text) ?? [];
  if (!year) return false;
  const found = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return found.getUTCMonth() === Number(month) - 1 && found.getUTCDate() === Number(day);
}

/** True when the text is a date and time the clock has: no hour 24, minute 60 or second 60. */
function realDateTime(text: string): boolean {
  const [, day, hour, minute, second] = datetime.exec(text) ?? [];
  return (
    day !== undefined &&
    realDay(day) &&
    Number(hour) < 24 &&
    Number(minute) < 60 &&
    Number(second ?? 0) < 60
  );
}

/** Whether a literal fits `date` or `datetime`; other types are not judged here. */
function isReal(type: ParameterDef["type"], value: unknown): boolean {
  if (typeof value !== "string") return true; // definitions judges the type of other values
  if (type === "date") return realDay(value);
  return type !== "datetime" || realDateTime(value);
}

/** Problems for the defaults and literal trigger values of a flow's date and datetime parameters. */
function dateProblems(table: ResolvedTable): string[] {
  const { parameters = {}, triggers = [] } = table.ingest!;
  const flow = table.origin.id;
  return Object.entries(parameters).flatMap(([name, { type, default: value }]) => {
    const given = [
      { where: "default", value },
      ...triggers.map((trigger) => ({
        where: `value in the trigger "${trigger.name}"`,
        value: trigger.parameters[name],
      })),
    ];
    return given
      .filter((item) => item.value !== undefined && !isReal(type, item.value))
      .map(
        (item) =>
          `The parameter "${name}" of the flow "${flow}" is a ${type} and its ${item.where} is ${JSON.stringify(item.value)}, which is not a real ${type}`,
      );
  });
}

/** `load` is a parameter only when a trigger sets it, so a filter may read it only then. */
function loadProblems(table: ResolvedTable): string[] {
  const { filter, parameters = {} } = table.ingest!;
  const reads = filter !== undefined && parameterReferences(filter).includes("load");
  return reads && !setsLoad(table) && !Object.hasOwn(parameters, "load")
    ? [
        `The filter of the table "${table.name}" reads {{ parameters.load }}, which no trigger of its flow sets; set \`load\` in a trigger's parameters`,
      ]
    : [];
}

/** What the pack refuses in the parameters and filters of flows, each flow's parameters once. */
export function flowParameterProblems(model: ResolvedModel): string[] {
  const seen = new Set<string>();
  const tables = model.tables.filter((table) => table.ingest?.pack === "adf");
  return tables.flatMap((table) => {
    const own = table.origin.kind === "Flow" && !seen.has(table.origin.id);
    seen.add(table.origin.id);
    return [...(own ? dateProblems(table) : []), ...loadProblems(table)];
  });
}

/** What the pack refuses in the triggers, parameters and filters of flows, and in flows as a whole. */
export const flowProblems = (model: ResolvedModel): string[] => [
  ...flowTriggerProblems(model),
  ...flowScopeProblems(model),
  ...flowParameterProblems(model),
];
