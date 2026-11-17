// A flow table's source filter as ADF text. Each `{{ parameters.<name> }}` becomes a typed, escaped
// piece of an ADF expression, never raw text: a run can be started by hand with any value.
import { type ParameterDef } from "@ingestron/definitions";

/** A piece of query text: plain text, or an ADF expression that gives a value at run time. */
export type Segment = string | { value: string; numeric?: boolean };

const reference = /\{\{\s*parameters\.([A-Za-z0-9_]+)\s*\}\}/g;

/**
 * A literal value where ADF reads expressions, such as a trigger's parameter value: a string
 * that starts with `@`, or holds `@{`, is escaped as ADF documents (`@@` for the leading `@`,
 * `@@{` for each `@{`), so it reaches the pipeline as written. Other values are as they are.
 * @example plainValue("@home") // "@@home"
 */
export const plainValue = <T>(value: T): T =>
  (typeof value === "string" ? value.replace(/^@|@\{/g, (found) => `@${found}`) : value) as T;

/** An ADF string literal: single quotes doubled. */
export const literal = (text: string): string => `'${text.replaceAll("'", "''")}'`;

/**
 * A window time as SQL Server's datetime reads it. Times arrive with seven fractional digits and
 * a zone, which it cannot convert; this form works for every date type.
 */
export const stamp = (name: string): string =>
  `formatDateTime(pipeline().parameters.${name}, 'yyyy-MM-dd HH:mm:ss')`;

const parameter = (name: string) => `pipeline().parameters.${name}`;
const quoted = (value: string): Segment[] => ["'", { value }, "'"];
// A date is read by ADF, so a value that is not one fails the expression instead of reaching SQL.
// In parentheses, so a negative value cannot join a `-` before it into a `--` comment.
const numeric = (value: string): Segment[] => ["(", { value, numeric: true }, ")"];
const dated = (name: string, format: string) =>
  quoted(`formatDateTime(${parameter(name)}, '${format}')`);

/** The pieces for one parameter, by the type the flow declares; undeclared names read as text. */
function pieces(name: string, type: ParameterDef["type"] | "window" | undefined): Segment[] {
  switch (type) {
    case "window":
      return quoted(stamp(name));
    case "date":
      return dated(name, "yyyy-MM-dd");
    case "datetime":
      return dated(name, "yyyy-MM-dd HH:mm:ss");
    case "int":
    case "float":
      return numeric(`${type}(${parameter(name)})`);
    case "bool":
      return [{ value: `if(bool(${parameter(name)}), '1', '0')` }];
    default:
      return quoted(`replace(${parameter(name)}, '''', '''''')`);
  }
}

/** The text of `filter` with every parameter reference replaced by its typed pieces. */
export function filterSegments(
  filter: string,
  parameters: Record<string, ParameterDef> = {},
): Segment[] {
  const found = [...filter.matchAll(reference)];
  const parts: Segment[] = [];
  let from = 0;
  for (const match of found) {
    const name = match[1]!;
    const declared = Object.hasOwn(parameters, name) ? parameters[name]!.type : undefined;
    const type =
      declared ?? (name === "windowStart" || name === "windowEnd" ? "window" : undefined);
    parts.push(filter.slice(from, match.index), ...pieces(name, type));
    from = match.index + match[0].length;
  }
  return [...parts, filter.slice(from)];
}

/** Whether any piece is evaluated at run time. */
export const hasValues = (segments: Segment[]): boolean =>
  segments.some((segment) => typeof segment !== "string");

/** The segments as text for an interpolated string: values are `@{…}`. */
export const interpolated = (segments: Segment[]): string =>
  segments
    .map((segment) => (typeof segment === "string" ? segment : `@{${segment.value}}`))
    .join("");

/** The segments as one ADF expression: a literal (`''` for none), or `concat(…)` of literals and values. */
export function concatenated(segments: Segment[]): string {
  const merged: Segment[] = [];
  for (const segment of segments) {
    const last = merged.at(-1);
    if (typeof segment === "string" && typeof last === "string")
      merged[merged.length - 1] = last + segment;
    else if (segment !== "") merged.push(segment);
  }
  const parts = merged.map((segment) =>
    typeof segment === "string"
      ? literal(segment)
      : segment.numeric
        ? `string(${segment.value})`
        : segment.value,
  );
  if (parts.length === 0) return "''";
  return parts.length === 1 ? parts[0]! : `concat(${parts.join(", ")})`;
}

/**
 * The filter as ADF interpolation text, each parameter a typed, escaped literal.
 * @example renderFilter("d >= {{ parameters.min_date }}", { min_date: { type: "date", default: "2020-01-01" } })
 */
export function renderFilter(filter: string, parameters: Record<string, ParameterDef>): string {
  return interpolated(filterSegments(filter, parameters));
}
