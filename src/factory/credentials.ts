// The factory credentials that user-assigned managed identity linked services
// reference. Microsoft's export refuses a linked service whose credential is not in
// the factory's Git folder ("Cannot reference to an invalid or deleted Credential
// object"), so the pack writes each one, with the identity's resource ID from the
// connection's `identity` setting (spec/references.md).
import type { ResolvedModel } from "@ingestron/definitions";
import { addResource } from "./resource-files.js";

/** Each credential's identity, by credential name, from the tables that use it. */
export function credentialIdentities(model: ResolvedModel): Map<string, string> {
  const identities = new Map<string, { identity: string; connection: string }>();
  for (const table of model.tables) {
    const ingest = table.ingest;
    if (ingest?.method !== "adf-copy") continue;
    const settings = ingest.connection.settings;
    if (settings.authentication !== "UserAssignedManagedIdentity") continue;
    const name = String(settings.credential);
    const identity = String(settings.identity);
    const known = identities.get(name);
    if (known !== undefined && known.identity !== identity)
      throw new Error(
        `ADF credential ${name} is given the identity ${known.identity} by connection ${known.connection} and ${identity} by connection ${ingest.connection.id}; give connections that share a credential the same identity, or each its own credential`,
      );
    identities.set(name, { identity, connection: ingest.connection.id });
  }
  return new Map([...identities].map(([name, { identity }]) => [name, identity]));
}

/** Adds `credential/<name>.json`, a managed identity credential, for each one used. */
export function addCredentials(files: Record<string, string>, model: ResolvedModel): void {
  const identities = credentialIdentities(model);
  for (const name of [...identities.keys()].sort())
    addResource(files, "credential", {
      name,
      properties: { type: "ManagedIdentity", typeProperties: { resourceId: identities.get(name) } },
    });
}

/** The platform request's line for each credential: its identity must be on the factory. */
export function credentialLines(model: ResolvedModel): string[] {
  return [...credentialIdentities(model)].map(
    ([name, identity]) =>
      `Credential \`${name}\`: assign the user-assigned managed identity \`${identity}\` to the factory before deploying, with the Managed Identity Operator role for whoever deploys; the credential refers to it.`,
  );
}
