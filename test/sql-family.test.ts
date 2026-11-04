import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adf } from "../src/index.js";
import { base, generate, json } from "./erp.js";
import { identityProject, resolveAll } from "./fold-helpers.js";

const cases = JSON.parse(
  readFileSync(new URL("../spec/conformance/sql-family.json", import.meta.url), "utf8"),
) as {
  connector: string;
  service: string;
  dataset: string;
  source: string;
  authentication: string[];
}[];
const connection = (connector: string, settings: string) =>
  base["erp.yaml"]!.replace("connector: sqlserver", `connector: ${connector}`).split(
    "settings:",
  )[0] + `settings:\n  server: source.example.test\n${settings}\n`;

const identity =
  "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-data/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-erp";
const credentials: Record<string, string> = {
  SQL: "  user: reader\n  password: ${secret:source-password}",
  Windows: "  user: corp\\reader\n  password: ${secret:source-password}",
  ServicePrincipal:
    "  tenant: tenant-id\n  client_id: client-id\n  client_secret: ${secret:client-secret}",
  SystemAssignedManagedIdentity: "",
  UserAssignedManagedIdentity: `  credential: source-identity\n  identity: ${identity}`,
};

describe("SQL family native resources", () => {
  for (const item of cases) {
    for (const authentication of item.authentication) {
      it(`generates ${item.connector} with ${authentication} from definitions`, () => {
        const { result, files } = generate({
          "erp.yaml": connection(
            item.connector,
            `  authentication: ${authentication}\n${credentials[authentication]}`,
          ),
        });
        expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual(
          [],
        );
        expect(result.model).toBeDefined();
        const service = json(files, "linkedService/ls_erp_erp_erp.json").properties;
        expect(service.type).toBe(item.service);
        expect(service.typeProperties.authenticationType).toBe(authentication);
        expect(service.typeProperties.server).toBe("source.example.test");
        expect(service.typeProperties.database).toBe("erp");
        expect(service.typeProperties.trustServerCertificate).toBe(false);
        expect(json(files, "dataset/ds_erp_erp_erp.json").properties.type).toBe(item.dataset);
        const source = json(files, "pipeline/pl_erp_erp.json").properties.activities[0]
          .typeProperties.source;
        expect(source.type).toBe(item.source);
        expect(source.sqlReaderQuery).toContain("FROM [dbo].[Invoices]");
        if (authentication === "ServicePrincipal") {
          expect(service.typeProperties.servicePrincipalCredential).toMatchObject({
            type: "AzureKeyVaultSecret",
            secretName: "client-secret",
          });
          expect(service.typeProperties.tenant).toBe("tenant-id");
          expect(service.typeProperties.servicePrincipalId).toBe("client-id");
        }
        if (authentication === "UserAssignedManagedIdentity") {
          expect(service.typeProperties.credential).toEqual({
            type: "CredentialReference",
            referenceName: "source-identity",
          });
          expect(json(files, "credential/source-identity.json")).toEqual({
            name: "source-identity",
            properties: { type: "ManagedIdentity", typeProperties: { resourceId: identity } },
          });
        } else
          expect(Object.keys(files).some((path) => path.startsWith("credential/"))).toBe(false);
      });
    }
  }
  it("refuses missing conditional credentials and unknown connection settings", () => {
    const { result } = generate({
      "erp.yaml": connection(
        "azure-sql-database",
        "  authentication: ServicePrincipal\n  client_secert: wrong",
      ),
    });
    expect(result.model).toBeUndefined();
    expect(result.diagnostics.map((item) => item.message).join("\n")).toContain("client_secret");
    expect(result.diagnostics.map((item) => item.message).join("\n")).toContain("client_secert");
  });
  const managedIdentity = (settings: string) =>
    generate({
      "erp.yaml": connection(
        "azure-sql-database",
        `  authentication: UserAssignedManagedIdentity\n${settings}`,
      ),
    }).result.diagnostics.map((item) => item.message);

  it("refuses a user-assigned managed identity without the identity, naming the setting and its form", () => {
    expect(managedIdentity("  credential: source-identity")).toEqual([
      '"adf-copy" for table "invoices": the connection needs "settings.identity", the resource ID of the user-assigned managed identity, such as /subscriptions/<subscription>/resourceGroups/<group>/providers/Microsoft.ManagedIdentity/userAssignedIdentities/<name>: the pack writes the factory\'s credential with it, because Microsoft\'s export refuses a linked service whose credential the factory does not hold.',
    ]);
  });

  it("asks the platform to assign the identity to the factory before the credential deploys", () => {
    const { result } = generate({
      "erp.yaml": connection(
        "azure-sql-database",
        `  authentication: UserAssignedManagedIdentity\n  credential: source-identity\n  identity: ${identity}`,
      ),
    });
    expect(adf.request!(result.model!).flatMap((section) => section.lines)).toContain(
      `Credential \`source-identity\`: assign the user-assigned managed identity \`${identity}\` to the factory before deploying, with the Managed Identity Operator role for whoever deploys; the credential refers to it.`,
    );
  });

  it("refuses an identity that is not a resource ID, before deployment would", () => {
    expect(managedIdentity("  credential: source-identity\n  identity: id-erp")).toEqual([
      '"adf-copy" for table "invoices": the connection\'s identity "id-erp" is not a user-assigned managed identity\'s resource ID; give its resource ID, such as /subscriptions/<subscription>/resourceGroups/<group>/providers/Microsoft.ManagedIdentity/userAssignedIdentities/<name>.',
    ]);
    expect(
      managedIdentity(`  credential: source-identity\n  identity: ${identity.toLowerCase()}`),
    ).toEqual([]);
  });

  it("leaves an identity supplied when deploying to the deployment", () => {
    const project = identityProject();
    project["erp.yaml"] = project["erp.yaml"]!.replace(
      "'${values.identity}'",
      "'${envvar:ERP_IDENTITY}'",
    );
    expect(() => resolveAll(project, ["dev", "prod"])).not.toThrow();
  });

  it("refuses a credential name ADF does not accept", () => {
    expect(managedIdentity(`  credential: source.identity\n  identity: ${identity}`)).toEqual([
      '"adf-copy" for table "invoices": the connection\'s credential "source.identity" is not a name ADF accepts: 1 to 127 letters, digits, underscores and hyphens, starting and ending with a letter, digit or underscore.',
    ]);
  });

  it("refuses an identity with any other authentication", () => {
    const { result } = generate({
      "erp.yaml": connection(
        "azure-sql-database",
        `  authentication: SystemAssignedManagedIdentity\n  identity: ${identity}`,
      ),
    });
    expect(result.diagnostics.map((item) => item.message).join("\n")).toContain(
      'the connection setting "identity" is not supported for SystemAssignedManagedIdentity authentication',
    );
  });

  it("refuses one credential given two identities", () => {
    const second = connection(
      "azure-sql-database",
      `  authentication: UserAssignedManagedIdentity\n  credential: source-identity\n  identity: ${identity}2`,
    ).replace("id: erp", "id: crm");
    const { result } = generate({
      "erp.yaml": connection(
        "azure-sql-database",
        `  authentication: UserAssignedManagedIdentity\n  credential: source-identity\n  identity: ${identity}`,
      ),
      "crm.yaml": second,
      "crm-flow.yaml":
        "apiVersion: ingestron.io/v1\nkind: Flow\nid: crm\nsource: crm\ntables:\n  crm_invoices: { object: crm.dbo.Invoices, contract: invoices }\n",
    });
    expect(result.diagnostics.map((item) => item.message).join("\n")).toContain(
      `ADF credential source-identity is given the identity ${identity}2 by connection crm and ${identity} by connection erp; give connections that share a credential the same identity, or each its own credential`,
    );
  });

  it("refuses empty object components", () => {
    expect(
      generate({ "flow.yaml": base["flow.yaml"]!.replace("erp.dbo.Invoices", "erp..Invoices") })
        .result.model,
    ).toBeUndefined();
  });
});
