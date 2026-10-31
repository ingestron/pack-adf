// Validate the selected connector before emitting native properties.
import { isSecret, nonEmpty } from "./sql-auth.js";
import { webAuthProblems } from "./web-auth.js";
import type { TableSource, ConnectionField } from "./table-source.js";
/** Check known connection fields without copying unrecognised settings into native JSON. */
export function connectionProblems(
  source: Pick<TableSource, "id" | "fields">,
  settings: Record<string, unknown>,
): string[] {
  const problems: string[] =
    source.id === "rest" || source.id === "http" ? webAuthProblems(source.id, settings) : [];
  for (const key of Object.keys(settings))
    if (!Object.hasOwn(source.fields, key))
      problems.push(`the connection setting "${key}" is not supported for ${source.id}`);
  for (const [key, field] of Object.entries(source.fields)) {
    if (settings[key] === undefined && field.optional) continue;
    if (!validField(field, settings[key]))
      problems.push(`the connection needs "settings.${key}" as ${fieldDescription(field)}`);
  }
  return problems;
}

function validField(field: ConnectionField, value: unknown): boolean {
  if (field.secretMap) return validSecrets(value);
  if (field.secret) return isSecret(value);
  if (field.number) return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 65535;
  if (field.values) return typeof value === "string" && field.values.includes(value);
  return nonEmpty(value);
}

function fieldDescription(field: ConnectionField): string {
  if (field.secret) return "${secret:…}";
  if (field.secretMap) return "a mapping of header names to secret references";
  if (field.number) return "a positive whole number";
  return field.values?.join(" or ") ?? "non-empty text";
}
function validSecrets(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, secret]) => /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) && isSecret(secret),
    )
  );
}
