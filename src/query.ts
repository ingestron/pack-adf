// The SQL Server query of one copy: the contract's columns, renamed from
// their source names, and in incremental mode only the rows changed in the window.
import type { ResolvedTable } from "@ingestron/definitions";

type Data = Record<string, unknown>;

const bracket = (name: string) => `[${name.replaceAll("]", "]]")}]`;

/** The contract's columns; in incremental mode only rows changed in the window. */
export function query(table: ResolvedTable): string | Data {
  const ingest = table.ingest!;
  const [, schema, name] = ingest.object.split(".");
  // A column named differently at the source is selected under its contract name.
  const columns = table.contract.columns
    .map((column) =>
      column.physicalName && column.physicalName !== column.name
        ? `${bracket(column.physicalName)} AS ${bracket(column.name)}`
        : bracket(column.name),
    )
    .join(", ");
  const select = `SELECT ${columns} FROM ${bracket(schema ?? "")}.${bracket(name ?? "")}`;
  if (ingest.settings.mode !== "incremental") return select;
  const watermark = bracket(String(ingest.settings.watermark_column));
  // Window times arrive with seven fractional digits and a zone, which SQL
  // Server's datetime cannot convert; this form works for every date type.
  const at = (name: string) =>
    `'@{formatDateTime(pipeline().parameters.${name}, 'yyyy-MM-dd HH:mm:ss')}'`;
  const window = `${watermark} >= ${at("windowStart")} AND ${watermark} < ${at("windowEnd")}`;
  return { value: `${select} WHERE ${window}`, type: "Expression" };
}
