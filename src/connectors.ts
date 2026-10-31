// The sources this pack reads, described for the documentation site.
import { nativeFileConnectors } from "./native-file-resources.js";
import { tableConnectors } from "./table-method.js";
import { sqlAuthentication } from "./sql-auth.js";
import { sqlTypes } from "./sql-types.js";
import type { Connector } from "@ingestron/definitions";

const sqlSettings: Connector["settings"] = [
  { name: "server", description: "The host name the integration runtime reaches." },
  {
    name: "authentication",
    optional: true,
    description:
      "Authentication mode; defaults to SQL. Azure sources also accept ServicePrincipal, SystemAssignedManagedIdentity and UserAssignedManagedIdentity. SQL Server and RDS also accept Windows.",
  },
  { name: "user", description: "The login; required for SQL or Windows authentication." },
  {
    name: "password",
    description: "The login password; required for SQL or Windows authentication.",
    secret: true,
  },
  {
    name: "tenant",
    optional: true,
    description: "Tenant ID; required for ServicePrincipal authentication.",
  },
  {
    name: "client_id",
    optional: true,
    description: "Application ID; required for ServicePrincipal authentication.",
  },
  {
    name: "client_secret",
    optional: true,
    description: "Application secret; required for ServicePrincipal authentication.",
    secret: true,
  },
  {
    name: "credential",
    optional: true,
    description:
      "Existing ADF credential name; required for UserAssignedManagedIdentity authentication.",
  },
  {
    name: "host_name_in_certificate",
    optional: true,
    description: "Optional TLS certificate host name; defaults to the server host.",
  },
];

/** One entry per connector an ingest method reads. */
export const connectors: Connector[] = [
  ...tableConnectors,
  ...nativeFileConnectors,
  {
    id: "files",
    category: "Files and storage",
    title: "Files",
    method: "adf-files",
    object: "a folder under the share, such as sales/orders",
    settings: [
      { name: "path", description: "The share, such as \\\\fs01\\exports." },
      { name: "user", description: "The account that reads the share, such as corp\\ingest." },
      {
        name: "password",
        description: "The account's password, as a Key Vault secret.",
        secret: true,
      },
    ],
    generates:
      "a file server linked service through a self-hosted integration runtime, a binary copy pipeline and a tumbling window trigger",
    docs: "https://learn.microsoft.com/en-us/azure/data-factory/connector-file-system",
  },
  ...Object.entries(sqlTypes).map(([id, types]) => ({
    id,
    title: types.title,
    category: "Databases and analytics",
    method: "adf-copy",
    object: "database.schema.table",
    settings: sqlSettings
      .filter(
        (field) =>
          id.startsWith("azure-") ||
          !["tenant", "client_id", "client_secret", "credential"].includes(field.name),
      )
      .map((field) =>
        field.name === "authentication" ? { ...field, values: sqlAuthentication(id) } : field,
      ),
    generates: "a native linked service, a copy pipeline and a tumbling window trigger",
    maturity: { status: "GA", checked: "2026-10-28" },
    docs: `https://learn.microsoft.com/en-us/azure/data-factory/connector-${types.docs}`,
  })),
];
