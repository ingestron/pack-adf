import { expect, it } from "vitest";
import { generate } from "./erp.js";
import { tableProject } from "./table-project.js";

it("generates Salesforce Bulk API resources from explicit application credentials", () => {
  const result = generate(
    tableProject(
      "salesforce",
      "  url: https://synthetic.my.salesforce.com\n  client_id: synthetic-client\n  client_secret: ${secret:salesforce-client}\n  api_version: '60.0'",
      "Account",
    ),
  );
  expect(result.result.model, JSON.stringify(result.result.diagnostics)).toBeDefined();
  const entries = Object.values(result.files).map((text) => JSON.parse(text));
  expect(
    entries.find((entry) => entry.properties.type === "SalesforceV2")?.properties.typeProperties,
  ).toMatchObject({
    apiVersion: "60.0",
    authenticationType: "OAuth2ClientCredentials",
    clientSecret: { type: "AzureKeyVaultSecret", secretName: "salesforce-client" },
  });
  expect(
    entries.find((entry) => entry.properties.type === "SalesforceV2Object")?.properties
      .typeProperties,
  ).toEqual({ objectApiName: "Account" });
});
