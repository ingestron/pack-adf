import { expect, it } from "vitest";
import { base, generate } from "./erp.js";

it("copies S3 objects with native location and secret references", () => {
  const { result, files } = generate({
    "standard.yaml": base["standard.yaml"]!.replace("adf-copy:", "adf-files:\n      format: csv"),
    "erp.yaml":
      "apiVersion: ingestron.io/v1\nkind: Connection\nid: erp\nconnector: amazon-s3\nconnectivity: private\nsettings:\n  access_key: synthetic-access\n  secret_key: ${secret:s3-key}\n",
    "flow.yaml": base["flow.yaml"]!.replace("erp.dbo.Invoices", "sales/orders"),
  });
  expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
  const entries = Object.values(files).map((value) => JSON.parse(value));
  expect(
    entries.find((entry) => entry.properties.type === "AmazonS3")?.properties.typeProperties
      .secretAccessKey,
  ).toMatchObject({ type: "AzureKeyVaultSecret", secretName: "s3-key" });
  expect(
    entries.find((entry) => entry.name === "ds_erp_erp")?.properties.typeProperties.location,
  ).toMatchObject({ type: "AmazonS3Location" });
  const copy = entries.find((entry) => entry.name === "pl_erp_erp").properties.activities[0];
  expect(copy.inputs[0].parameters).toEqual({ root: "sales", folder: "orders" });
  expect(copy.typeProperties.source.storeSettings.type).toBe("AmazonS3ReadSettings");
  expect(copy.outputs[0].parameters.folder).toBe("erp/sales/orders");
});
