// The secure strings Microsoft's export adds of its own: for some linked service
// types, an optional secret that the linked service leaves out becomes a
// `secureString` parameter with no default, so every deployment must supply it.
// Leaving the property out, null or empty does not stop it; only a Key Vault
// reference in its place does (spec/references.md).

/**
 * By linked service type, the optional secrets the export adds when they are left out,
 * each with the connection setting that gives it from Key Vault, where there is one.
 */
export const addedSecrets: Readonly<Record<string, Readonly<Record<string, string | null>>>> = {
  Informix: { credential: "credential" },
  MicrosoftAccess: { credential: "credential" },
  SharePointOnlineList: { servicePrincipalEmbeddedCertPassword: "certificate_password" },
  SnowflakeV2: { privateKeyPassphrase: "private_key_password" },
  Square: { refreshToken: "refresh_token" },
  // OAuth 1.0's keys, which the OAuth 2.0 linked service does not use.
  Xero: { consumerKey: null, privateKey: null },
};

/** A secure string parameter the export adds, for the linked service and property it stands for. */
export interface AddedSecret {
  /** The parameter's name, `<linked service>_<property>`. */
  name: string;
  linkedService: string;
  type: string;
  property: string;
  /** The connection setting that gives the secret from Key Vault, if any. */
  setting: string | null;
}

/** The parameters the export adds for the linked services among `files` (ADF's Git folders). */
export function addedSecretParameters(files: Readonly<Record<string, string>>): AddedSecret[] {
  return Object.keys(files)
    .filter((path) => path.startsWith("linkedService/"))
    .sort()
    .flatMap((path) => {
      const resource = JSON.parse(files[path]!) as {
        name: string;
        properties: { type: string; typeProperties?: Record<string, unknown> };
      };
      const { type, typeProperties = {} } = resource.properties;
      return Object.entries(addedSecrets[type] ?? {})
        .filter(([property]) => typeProperties[property] === undefined)
        .map(([property, setting]) => ({
          name: `${resource.name}_${property}`,
          linkedService: resource.name,
          type,
          property,
          setting,
        }));
    });
}

/** The platform request's line for each such parameter. */
export function addedSecretLines(files: Readonly<Record<string, string>>): string[] {
  return addedSecretParameters(files).map(
    (secret) =>
      `ARM parameter \`${secret.name}\`: Microsoft's export adds it, a secure string with no default, for the ${secret.type} linked service's optional \`${secret.property}\`, which \`${secret.linkedService}\` leaves out. Supply it when deploying each environment${secret.setting ? `, or set the connection's \`${secret.setting}\` to a Key Vault secret so the export does not add it` : ""}.`,
  );
}
