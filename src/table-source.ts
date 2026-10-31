// The native properties shared by concrete tabular connectors, not a plugin API.

/** One allowlisted connection field and the native property it supplies. */
export interface ConnectionField {
  native: string;
  description: string;
  secret?: boolean;
  secretMap?: boolean;
  optional?: boolean;
  number?: boolean;
  values?: string[];
}

/** Native facts for a full-copy table source; all vendor constants stay in the pack. */
export interface TableSource {
  id: string;
  title: string;
  docs: string;
  service: string;
  dataset: string;
  source: string;
  object: string[];
  fields: Record<string, ConnectionField>;
  defaults?: Record<string, unknown>;
  version?: string;
  query?: boolean;
  queryRequired?: boolean;
  queryProperty?: string;
  hierarchical?: boolean;
  staged?: boolean;
  runtime?: "self-hosted" | "azure";
}

/** A required text field mapped to one native property. */
export function textField(native: string, description: string): ConnectionField {
  return { native, description };
}

/** A required secret, supplied by name rather than value. */
export function secretField(native: string, description: string): ConnectionField {
  return { native, description, secret: true };
}

/** The basic database credentials used by several native drivers. */
export const databaseFields = {
  server: textField("server", "Database host name or endpoint as reached by the runtime."),
  database: textField("database", "Database to read."),
  user: textField("username", "Account used to read the source."),
  password: secretField("password", "Key Vault secret holding the account password."),
};

/** An optional numeric port; the vendor default applies when omitted. */
export const portField: ConnectionField = {
  native: "port",
  description: "Source TCP port.",
  number: true,
  optional: true,
};
