// Exports which need connector-specific staging or landing authentication.
import { secretField as secret, textField as text, type TableSource } from "./table-source.js";
/** Native exports; staging and source filters remain ordinary definition settings. */
export const tableExports: TableSource[] = [
  {
    id: "snowflake",
    title: "Snowflake",
    docs: "snowflake",
    service: "SnowflakeV2",
    dataset: "SnowflakeV2Table",
    source: "SnowflakeV2Source",
    object: ["schema", "table"],
    fields: {
      account: text("accountIdentifier", "Snowflake account identifier, including organisation."),
      database: text("database", "Database to read."),
      warehouse: text("warehouse", "Warehouse used for exports."),
      user: text("user", "Key-pair account."),
      private_key: secret("privateKey", "PEM private key in Key Vault."),
      private_key_password: {
        ...secret("privateKeyPassphrase", "Private key passphrase in Key Vault."),
        optional: true,
      },
      role: { ...text("role", "Optional Snowflake role."), optional: true },
    },
    defaults: { authenticationType: "KeyPair" },
    version: "1.1",
    query: true,
    staged: true,
  },
  {
    id: "azure-databricks-delta",
    title: "Azure Databricks Delta Lake",
    docs: "azure-databricks-delta-lake",
    service: "AzureDatabricksDeltaLake",
    dataset: "AzureDatabricksDeltaLakeDataset",
    source: "AzureDatabricksDeltaLakeSource",
    object: ["database", "table"],
    fields: {
      url: text("domain", "Databricks workspace URL."),
      cluster_id: text("clusterId", "Existing cluster ID."),
      workspace_resource_id: text(
        "workspaceResourceId",
        "Azure workspace resource ID; uses the factory managed identity.",
      ),
    },
    query: true,
    staged: true,
    runtime: "azure",
  },
  {
    id: "microsoft-365",
    title: "Microsoft 365",
    docs: "office-365",
    service: "Office365",
    dataset: "Office365Table",
    source: "Office365Source",
    object: ["tableName"],
    fields: {
      tenant: text("office365TenantId", "Microsoft 365 tenant ID."),
      application_tenant: text("servicePrincipalTenantId", "Application tenant ID."),
      client_id: text(
        "servicePrincipalId",
        "Application client ID; also used for landing storage.",
      ),
      client_secret: secret(
        "servicePrincipalKey",
        "Application secret in Key Vault; also used for landing storage.",
      ),
    },
    defaults: { servicePrincipalCredentialType: "ServicePrincipalKey" },
    runtime: "azure",
  },
];
