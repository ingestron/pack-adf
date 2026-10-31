// Where ADF lands a table's files: one file replaced each run (snapshot), a
// new file per run (increments), or a path pattern of the project's own.
import type { ResolvedTable } from "@ingestron/definitions";
import { parseLanding } from "./landing.js";

/** How a table's files are laid out in the landing folder. */
export type Layout = "snapshot" | "increments" | "path";

/** The landed files' extension, from the method's format. */
export type Extension = "parquet" | "json";

const windowParts = ["yyyy", "MM", "dd", "HH"];
const tokens = ["object", "connection", ...windowParts, "run"];
const tokenPattern = /\{([^{}]*)\}/g;

/**
 * `path` when the table sets a path pattern; else its `layout`; else
 * `snapshot` when the table ends at the landed files, `increments` otherwise.
 * @example layoutOf(table) // "snapshot"
 */
export function layoutOf(table: ResolvedTable): Layout {
  const { layout, path } = table.ingest!.settings;
  if (typeof path === "string") return "path";
  if (layout === "snapshot" || layout === "increments") return layout;
  return table.endsAtFiles ? "snapshot" : "increments";
}

/**
 * ADF expressions for the sink: the folder under the landing file system,
 * and the file name.
 * @example landedFile(table, "parquet") // { folder: "erp/erp.dbo.Invoices", file: "erp.dbo.Invoices.parquet" }
 */
export function landedFile(
  table: ResolvedTable,
  extension: Extension,
): { folder: string; file: string } {
  const ingest = table.ingest!;
  const { path } = parseLanding(String(ingest.settings.landing));
  const relative =
    layoutOf(table) === "increments"
      ? `${ingest.object}/${incrementName(extension)}`
      : relativePath(table, extension, (part) => expressionOf(table, part));
  const slash = relative.lastIndexOf("/");
  const folder = [path, relative.slice(0, Math.max(slash, 0))].filter(Boolean).join("/");
  return { folder, file: relative.slice(slash + 1) };
}

/**
 * The landed location as a URL, with `*` for each date or run token.
 * @example landedLocation(table, "parquet") // "abfss://landing@acct.dfs.core.windows.net/erp/orders/*.parquet"
 */
export function landedLocation(table: ResolvedTable, extension: Extension): string {
  const landing = String(table.ingest!.settings.landing).replace(/\/+$/, "");
  const relative = relativePath(table, extension, (part) =>
    part === "object" || part === "connection" ? expressionOf(table, part) : "*",
  );
  return `${landing}/${relative}`;
}

/**
 * True when each run writes the same file: a snapshot, or a path pattern
 * without date or run tokens.
 * @example replacesFile(table) // true
 */
export function replacesFile(table: ResolvedTable): boolean {
  const layout = layoutOf(table);
  if (layout !== "path") return layout === "snapshot";
  const used = [...String(table.ingest!.settings.path).matchAll(tokenPattern)].map(
    (match) => match[1],
  );
  return !used.some((name) => name === "run" || windowParts.includes(name ?? ""));
}

/**
 * Problems with a path pattern, as METHOD_CHECK messages.
 * @example pathProblems("{object}/", "parquet") // ['the path pattern "{object}/" must end in a file name']
 */
export function pathProblems(path: string, extension: Extension): string[] {
  const quoted = `the path pattern "${path}"`;
  if (path.endsWith("/") || path.split("/").at(-1) === "")
    return [`${quoted} must end in a file name`];
  const unknown = [...path.matchAll(tokenPattern)]
    .map((match) => match[1] ?? "")
    .filter((name) => !tokens.includes(name))
    .map((name) => `${quoted} uses an unknown token {${name}}; tokens: ${tokens.join(", ")}`);
  const suffix = path.endsWith(`.${extension}`) ? [] : [`${quoted} must end in .${extension}`];
  return [...unknown, ...suffix];
}

/** The file's path under the landing folder, with each token replaced. */
function relativePath(
  table: ResolvedTable,
  extension: Extension,
  replace: (token: string) => string,
): string {
  const object = table.ingest!.object;
  const layout = layoutOf(table);
  if (layout === "snapshot") return `${object}/${object}.${extension}`;
  if (layout === "increments") return `${object}/*.${extension}`;
  return String(table.ingest!.settings.path).replace(tokenPattern, (_match, name: string) =>
    replace(name),
  );
}

/** A token as ADF writes it: a literal, or an expression over the window or the run. */
function expressionOf(table: ResolvedTable, token: string): string {
  if (token === "object") return table.ingest!.object;
  if (token === "connection") return table.ingest!.connection.id;
  if (token === "run") return "@{pipeline().RunId}";
  return `@{formatDateTime(pipeline().parameters.windowStart, '${token}')}`;
}

/** A new file per run: the window's start and the run id, so reruns never overwrite. */
function incrementName(extension: Extension): string {
  return `@{concat(formatDateTime(pipeline().parameters.windowStart, 'yyyyMMddHHmmss'), '_', pipeline().RunId, '.${extension}')}`;
}
