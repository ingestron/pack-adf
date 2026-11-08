// Where a source's transport decides its authentication, as Hive's does: Microsoft's Hive
// connector supports only Anonymous authentication over Binary transport, and only
// UsernameAndPassword over SASL (spec/references.md, "Hive authentication").
import type { TableSource } from "./table-source.js";

/** The authentication the transport takes, or undefined when the source has no such rule. */
export function transportAuthentication(
  source: TableSource,
  settings: Record<string, unknown>,
): string | undefined {
  return source.transportAuthentication?.[String(settings.transport)];
}

/** A login given where the transport takes none, or missing where it needs one. */
export function transportProblems(
  source: TableSource,
  settings: Record<string, unknown>,
): string[] {
  const authentication = transportAuthentication(source, settings);
  if (authentication === undefined) return [];
  const login = settings.user !== undefined || settings.password !== undefined;
  if (authentication === "Anonymous")
    return login
      ? [
          `${settings.transport} transport connects anonymously: leave out user and password, or use another transport`,
        ]
      : [];
  return settings.user !== undefined && settings.password !== undefined
    ? []
    : [`${settings.transport} transport needs "settings.user" and "settings.password"`];
}
