// Explicit authentication for web sources; headers never contain literal credentials.
import { isSecret, nonEmpty } from "./sql-auth.js";
import { secretField as secret, textField as text } from "./table-source.js";
type Data = Record<string, unknown>;
/** REST and HTTP fields shown by the ordinary connection authoring surfaces. */
export const webFields = {
  auth_headers: {
    native: "authHeaders",
    description: "Authentication header names mapped to Key Vault secret references.",
    secretMap: true,
    optional: true,
  },
  url: text("url", "Base HTTPS URL."),
  authentication: {
    ...text(
      "authenticationType",
      "Anonymous by default. Basic needs user/password; OAuth2ClientCredential needs client_id, client_secret and token_endpoint.",
    ),
    optional: true,
    values: ["Anonymous", "Basic", "OAuth2ClientCredential"],
  },
  user: { ...text("userName", "User for Basic authentication."), optional: true },
  password: { ...secret("password", "Password for Basic authentication."), optional: true },
  client_id: {
    ...text("clientId", "Client ID; required for OAuth2ClientCredential."),
    optional: true,
  },
  client_secret: {
    ...secret("clientSecret", "Client secret in Key Vault; required for OAuth2ClientCredential."),
    optional: true,
  },
  token_endpoint: {
    ...text("tokenEndpoint", "Token endpoint URL; required for OAuth2ClientCredential."),
    optional: true,
  },
  scope: { ...text("scope", "Optional OAuth scope."), optional: true },
  resource: {
    ...text("resource", "OAuth resource audience when required by the token endpoint."),
    optional: true,
  },
};
const authFields: Record<string, string[]> = {
  Basic: ["user", "password"],
  OAuth2ClientCredential: ["client_id", "client_secret", "token_endpoint"],
};
/** Require credentials for the selected mode and reject inapplicable fields. */
export function webAuthProblems(connector: string, settings: Data): string[] {
  const mode = settings.authentication ?? "Anonymous";
  const fields = authFields[String(mode)] ?? [];
  const problems: string[] = [];
  if (connector === "http" && mode === "OAuth2ClientCredential")
    problems.push("HTTP supports Anonymous or Basic authentication");
  for (const field of fields)
    if (!validCredential(field, settings[field]))
      problems.push(`${mode} authentication requires settings.${field}`);
  for (const key of Object.keys(settings))
    if (
      ![
        "url",
        "auth_headers",
        "authentication",
        ...fields,
        ...(mode === "OAuth2ClientCredential" ? ["scope", "resource"] : []),
      ].includes(key)
    )
      problems.push(`settings.${key} does not apply to ${String(mode)} authentication`);
  return problems;
}

function validCredential(field: string, value: unknown): boolean {
  return field === "password" || field === "client_secret" ? isSecret(value) : nonEmpty(value);
}
