import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { base, generate, json } from "./erp.js";

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

const credentials: Record<string, string> = {
  SQL: "  user: reader\n  password: ${secret:source-password}",
  Windows: "  user: corp\\reader\n  password: ${secret:source-password}",
  ServicePrincipal:
    "  tenant: tenant-id\n  client_id: client-id\n  client_secret: ${secret:client-secret}",
  SystemAssignedManagedIdentity: "",
  UserAssignedManagedIdentity: "  credential: source-identity",
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
        if (authentication === "UserAssignedManagedIdentity")
          expect(service.typeProperties.credential).toEqual({
            type: "CredentialReference",
            referenceName: "source-identity",
          });
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
  it("refuses empty object components", () => {
    expect(
      generate({ "flow.yaml": base["flow.yaml"]!.replace("erp.dbo.Invoices", "erp..Invoices") })
        .result.model,
    ).toBeUndefined();
  });
});
