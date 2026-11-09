// Helpers for the intent tests: the ERP project resolved with ADF and the test store pack.
import { memoryFiles } from "@ingestron/config";
import { resolveDefinitions } from "@ingestron/definitions";
import { adf } from "../src/index.js";
import { base, json } from "./erp.js";
import { store } from "./store-pack.js";
import { tableProject } from "./table-project.js";

/** The ERP project resolved with the test store pack and ADF, and ADF's files. */
export function generate(changes: Record<string, string> = {}) {
  const result = resolveDefinitions(memoryFiles({ ...base, ...changes }), {
    packs: [store, adf],
    environment: "dev",
  });
  return { result, files: result.model ? adf.build(result.model) : {} };
}

export { base };

export const withLines = (lines: string[], standard = base["standard.yaml"]!) =>
  standard.replace(
    "      start: 2026-10-01T00:00:00Z\n",
    `      start: 2026-10-01T00:00:00Z\n${lines.map((line) => `      ${line}`).join("\n")}\n`,
  );

/** The standard with extra top-level lines, such as layers or operations. */
export const standardWith = (lines: string[], standard = base["standard.yaml"]!) =>
  `${standard}${lines.join("\n")}\n`;

export const flowWith = (table: string) =>
  `apiVersion: ingestron.io/v1\nkind: Flow\nid: erp\nsource: erp\ntables:\n  invoices: { object: erp.dbo.Invoices, contract: invoices${table} }\n`;

export const pipeline = (files: Record<string, string>) => json(files, "pipeline/pl_erp_erp.json");

export const salesforce = () =>
  tableProject(
    "salesforce",
    "  url: https://synthetic.my.salesforce.com\n  client_id: synthetic-client\n  client_secret: ${secret:salesforce-client}\n  api_version: '60.0'",
    "Account",
  );
