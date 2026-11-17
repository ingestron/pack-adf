// The filters of a ForEach pipeline's tables, as run-time text. The tables parameter can be
// overridden when a run starts, and an expression in an item's text is never evaluated, so a
// filter is not carried in an item: each table's filter is built, with typed and escaped
// parameters, for the item whose `table` names it.
import type { ResolvedTable } from "@ingestron/definitions";
import { concatenated, filterSegments, literal, stamp } from "../design/index.js";

/** Table names with the expression that builds their filter, for each distinct filter. */
function filtersOf(tables: ResolvedTable[]): { names: string[]; expression: string }[] {
  const found = new Map<string, string[]>();
  for (const table of tables) {
    const { filter, parameters } = table.ingest!;
    if (filter === undefined) continue;
    const expression = concatenated(filterSegments(filter, parameters));
    found.set(expression, [...(found.get(expression) ?? []), table.name]);
  }
  return [...found].map(([expression, names]) => ({ names, expression }));
}

const isTable = (names: string[]) =>
  names.length === 1
    ? `equals(item().table, ${literal(names[0]!)})`
    : `contains(createArray(${names.map(literal).join(", ")}), item().table)`;

/**
 * What a ForEach's query adds after the item's select when a table of the group has a filter: the
 * window in parentheses, unless `skip` says to leave it out, then the filter of the item's table
 * joined to it by `AND`, its closing parenthesis on a line of its own so that a `--` comment
 * ending the filter cannot comment it out. "" when no table has a filter, so the query is as it was.
 */
export function windowAndFilter(tables: ResolvedTable[], skip: string): string {
  const filters = filtersOf(tables);
  if (filters.length === 0) return "";
  const window =
    `concat(' WHERE (', item().watermark, ' >= ''', ${stamp("windowStart")}, ''' AND ', ` +
    `item().watermark, ' < ''', ${stamp("windowEnd")}, ''')')`;
  const filter = filters.reduceRight(
    (rest, { names, expression }) =>
      `if(${isTable(names)}, concat(if(${skip}, ' WHERE (', ' AND ('), ${expression}, '\n)'), ${rest})`,
    "''",
  );
  return `@{if(${skip}, '', ${window})}@{${filter}}`;
}
