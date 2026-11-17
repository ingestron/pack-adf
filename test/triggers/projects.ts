// Projects that write no triggers or parameters, one for each way ADF copies, and the same
// ERP project with a second flow. Their output must stay as it was before flows had pipelines.
import { base, generate } from "../erp.js";
import { tableProject } from "../table-project.js";

const standard = base["standard.yaml"]!;
const files = {
  "standard.yaml": standard.replace("adf-copy:", "adf-files:\n      format: csv"),
  "erp.yaml":
    "apiVersion: ingestron.io/v1\nkind: Connection\nid: erp\nconnector: amazon-s3\nconnectivity: private\nsettings:\n  access_key: synthetic-access\n  secret_key: ${secret:s3-key}\n",
  "flow.yaml": base["flow.yaml"]!.replace("erp.dbo.Invoices", "sales/orders"),
};

/** The projects whose output is pinned, by name. */
export const projects: Record<string, Record<string, string>> = {
  copy: {},
  foreach: { "standard.yaml": standard.replace("adf-copy:", "adf-copy:\n      pattern: foreach") },
  files,
  table: tableProject(
    "salesforce",
    "  url: https://synthetic.my.salesforce.com\n  client_id: synthetic-client\n  client_secret: ${secret:salesforce-client}\n  api_version: '60.0'",
    "Account",
  ),
};

/** The flow `b`, on the connection of the ERP flow, with the ingest settings written under it. */
export const secondFlow = (ingest: string) =>
  `apiVersion: ingestron.io/v1\nkind: Flow\nid: b\nsource: erp\ningest:\n${ingest}\ntables:\n  credits: { object: erp.dbo.Credits, contract: invoices }\n`;

export const build = (changes: Record<string, string>) => generate(changes);
