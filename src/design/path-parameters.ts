// The parameters a landing path or an audit column may read: the ones the flow declares, and the
// built-ins its pipeline always has (`windowStart`, `windowEnd`) or has when a trigger sets it (`load`).
import type { ResolvedTable } from "@ingestron/definitions";
import { setsLoad } from "./query.js";

/** The prefix of a path token that names a parameter. */
export const parameterPrefix = "parameters.";

/**
 * The names a path token or an audit value may give: the declared parameters, `windowStart`,
 * `windowEnd`, and `load` when a trigger of the flow sets it.
 * @example parameterNames(table) // ["windowStart", "windowEnd", "region"]
 */
export function parameterNames(table: ResolvedTable): string[] {
  return [
    "windowStart",
    "windowEnd",
    ...(setsLoad(table) ? ["load"] : []),
    ...Object.keys(table.ingest!.parameters ?? {}),
  ];
}

/** Text with `/`, `\` and `..` replaced, so a value typed by hand cannot leave the table's folder. */
const contained = (ref: string): string =>
  `replace(replace(replace(${ref}, '/', '_'), '\\', '_'), '..', '_')`;

/**
 * The parameter as ADF writes it in a path, by its type: dates by day (a datetime by second, with
 * no colon), numbers and booleans as text, and any other text kept inside its folder.
 * @example parameterInPath(table, "windowStart") // "@{formatDateTime(pipeline().parameters.windowStart, 'yyyy-MM-ddTHHmmss')}"
 */
export function parameterInPath(table: ResolvedTable, name: string): string {
  const ref = `pipeline().parameters.${name}`;
  const declared = table.ingest!.parameters ?? {};
  const type = Object.hasOwn(declared, name)
    ? declared[name]!.type
    : name === "windowStart" || name === "windowEnd"
      ? "datetime"
      : "string";
  switch (type) {
    case "date":
      return `@{formatDateTime(${ref}, 'yyyy-MM-dd')}`;
    case "datetime":
      return `@{formatDateTime(${ref}, 'yyyy-MM-ddTHHmmss')}`;
    case "int":
    case "float":
    case "bool":
      return `@{string(${ref})}`;
    default:
      return `@{${contained(ref)}}`;
  }
}
