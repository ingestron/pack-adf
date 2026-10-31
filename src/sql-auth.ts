// SQL family authentication, with secret values always left in Key Vault.
import type { ResolvedTable } from "@ingestron/definitions";

type Data = Record<string, unknown>;
const modeFields: Record<string, string[]> = {
  SQL: ["user", "password"],
  Windows: ["user", "password"],
  ServicePrincipal: ["tenant", "client_id", "client_secret"],
  SystemAssignedManagedIdentity: [],
  UserAssignedManagedIdentity: ["credential"],
};
const secretFields = new Set(["password", "client_secret"]);

/** Non-empty text, including names supplied through project/environment values. */
export function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** A secret reference with no literal credential or extra fields. */
export function isSecret(value: unknown): value is { $secret: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    nonEmpty((value as Data).$secret)
  );
}

/** A Key Vault reference, never the secret value. */
export function vaultSecret(value: unknown, keyVault: string): Data {
  return {
    type: "AzureKeyVaultSecret",
    store: { referenceName: keyVault, type: "LinkedServiceReference" },
    secretName: (value as { $secret: string }).$secret,
  };
}

/** Supported SQL authentication choices for the selected native connector. */
export function sqlAuthentication(connector: string): string[] {
  return connector.startsWith("azure-")
    ? ["SQL", "ServicePrincipal", "SystemAssignedManagedIdentity", "UserAssignedManagedIdentity"]
    : ["SQL", "Windows"];
}

/** Reject unsupported modes, missing credentials and silently ignored connection fields. */
export function sqlConnectionProblems(table: ResolvedTable): string[] {
  const connection = table.ingest!.connection;
  const settings = connection.settings;
  const mode = String(settings.authentication ?? "SQL");
  const fields = modeFields[mode] ?? [];
  const problems: string[] = [];
  if (!sqlAuthentication(connection.connector).includes(mode))
    problems.push(
      `the connection's authentication must be ${sqlAuthentication(connection.connector).join(", ")}`,
    );
  if (mode === "Windows" && table.ingest!.settings.runtime_kind !== "self-hosted")
    problems.push("Windows authentication requires runtime_kind: self-hosted");
  problems.push(...credentialFields(settings, fields));
  const allowed = ["server", "authentication", "host_name_in_certificate", ...fields];
  for (const key of Object.keys(settings))
    if (!allowed.includes(key))
      problems.push(`the connection setting "${key}" is not supported for ${mode} authentication`);
  if (
    settings.host_name_in_certificate !== undefined &&
    !nonEmpty(settings.host_name_in_certificate)
  )
    problems.push('the connection needs non-empty "settings.host_name_in_certificate"');
  return problems;
}

/** Native SQL linked-service authentication properties for validated definitions. */
export function sqlCredentials(settings: Data, keyVault: string): Data {
  const authenticationType = settings.authentication ?? "SQL";
  if (authenticationType === "SQL" || authenticationType === "Windows")
    return {
      authenticationType,
      userName: settings.user,
      password: vaultSecret(settings.password, keyVault),
    };
  if (authenticationType === "ServicePrincipal")
    return {
      authenticationType,
      tenant: settings.tenant,
      servicePrincipalId: settings.client_id,
      servicePrincipalCredential: vaultSecret(settings.client_secret, keyVault),
    };
  if (authenticationType === "UserAssignedManagedIdentity")
    return {
      authenticationType,
      credential: { referenceName: settings.credential, type: "CredentialReference" },
    };
  return { authenticationType };
}

/** Convert a validated secret or secret-header map into native Key Vault references. */
export function nativeValue(
  value: unknown,
  field: { secret?: boolean; secretMap?: boolean },
  keyVault: string,
): unknown {
  if (field.secret) return vaultSecret(value, keyVault);
  if (field.secretMap)
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, secret]) => [
        key,
        vaultSecret(secret, keyVault),
      ]),
    );
  return value;
}

function credentialFields(settings: Data, fields: string[]): string[] {
  const problems: string[] = [];
  for (const key of [
    ...fields.filter((key) => secretFields.has(key)),
    "server",
    ...fields.filter((key) => !secretFields.has(key)),
  ]) {
    if (secretFields.has(key)) {
      if (!isSecret(settings[key]))
        problems.push(
          `the connection's ${key} must be \${secret:…}, the name of a Key Vault secret`,
        );
    } else if (!nonEmpty(settings[key])) problems.push(`the connection needs "settings.${key}"`);
  }
  return problems;
}
