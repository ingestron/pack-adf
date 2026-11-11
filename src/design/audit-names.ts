// The names an audit column may not take, apart from the table's own columns.

/** Columns the packs that read the files add themselves (DuckDB's file name, Databricks' rescued data). */
export const reserved = ["_ingestron_file", "_rescued_data"];

/** Audit columns whose names differ only by case: the engines compare names case-insensitively. */
export function caseProblems(names: string[]): string[] {
  const seen = new Map<string, string>();
  const problems: string[] = [];
  for (const name of names) {
    const earlier = seen.get(name.toLowerCase());
    if (earlier)
      problems.push(`audit columns "${earlier}" and "${name}" differ only by case; rename one`);
    else seen.set(name.toLowerCase(), name);
  }
  return problems;
}
