// ADF's limit on the length of one expression (spec/references.md, "Expressions"): a query that
// reads parameters at run time is one expression, and grows with its columns and its filter.
import type { ResolvedModel, ResolvedTrigger } from "@ingestron/definitions";
import { query } from "../design/index.js";
import { foreachQuery } from "../resources/index.js";
import { copyGroups } from "./source-groups.js";

/** The most characters ADF allows in one expression. */
export const expressionLimit = 8192;

const count = (length: number) => length.toLocaleString("en-GB");

/** The text of a query when ADF evaluates it, as an expression; undefined for plain text. */
const expressionOf = (text: string | Record<string, unknown>) =>
  typeof text === "string" ? undefined : String(text.value);

/** The queries of the adf-copy tables, each with the tables it copies. */
function queries(model: ResolvedModel): { names: string[]; text?: string }[] {
  return copyGroups(model).flatMap((group) =>
    group.tables[0]!.ingest!.settings.pattern === "foreach"
      ? [{ names: group.tables.map((table) => table.name), text: foreachQuery(group.tables) }]
      : group.tables.map((table) => ({ names: [table.name], text: expressionOf(query(table)) })),
  );
}

/** The expressions a trigger passes its pipeline, by parameter name. */
function triggerExpressions(trigger: ResolvedTrigger): [string, string][] {
  return Object.entries(trigger.parameters).flatMap(([name, value]) =>
    typeof value === "object" ? [[name, value.expression] as [string, string]] : [],
  );
}

/** The triggers the flows of this pack write, each once. */
function flowTriggers(model: ResolvedModel): ResolvedTrigger[] {
  const found = new Map<string, ResolvedTrigger>();
  for (const table of model.tables.filter((item) => item.ingest?.pack === "adf"))
    for (const trigger of table.ingest!.triggers ?? [])
      found.set(`${trigger.flow}/${trigger.name}`, trigger);
  return [...found.values()];
}

/**
 * Each expression the pack would write that is longer than ADF allows: a table's query, naming
 * the table (or the tables of a ForEach) and its length, and a trigger's expression.
 * @example expressionProblems(model) // ['The query of the table "orders" is an ADF expression of 9,120 characters; …']
 */
export function expressionProblems(model: ResolvedModel): string[] {
  const limit = `ADF allows at most ${count(expressionLimit)} characters in an expression`;
  const tables = queries(model)
    .filter(({ text }) => text !== undefined && text.length > expressionLimit)
    .map(({ names, text }) => {
      const named = names.map((name) => `"${name}"`).join(", ");
      const which = names.length === 1 ? `the table ${named}` : `the tables ${named}`;
      return `The query of ${which} is an ADF expression of ${count(text!.length)} characters; ${limit}. Shorten its filter, or copy fewer columns`;
    });
  const triggers = flowTriggers(model).flatMap((trigger) =>
    triggerExpressions(trigger)
      .filter(([, text]) => text.length > expressionLimit)
      .map(
        ([name, text]) =>
          `The trigger "${trigger.flow}/${trigger.name}" passes "${name}" an expression of ${count(text.length)} characters; ${limit}`,
      ),
  );
  return [...tables, ...triggers];
}
