// The private ERP project the ADF tests share: SQL Server copied by ADF and
// stored by the test store pack.
import { memoryFiles } from "@ingestron/config";
import { resolveDefinitions } from "@ingestron/definitions";
import { adf } from "../src/index.js";
import { store } from "./store-pack.js";

export const landing = "abfss://landing@erplake.dfs.core.windows.net/erp";

export const base: Record<string, string> = {
  "project.yaml": "id: erp\nenvironments: { dev: {}, prod: {} }\nimports: ['*.yaml']\n",
  "standard.yaml": [
    "apiVersion: ingestron.io/v1",
    "kind: Standard",
    "id: acme",
    "packs: [store@1, adf@1]",
    "ingest:",
    "  settings:",
    "    adf-copy:",
    `      landing: ${landing}`,
    "      integration_runtime: shir-erp",
    "      key_vault: https://kv-erp.vault.azure.net",
    "      start: 2026-10-01T00:00:00Z",
    "",
  ].join("\n"),
  "erp.yaml": [
    "apiVersion: ingestron.io/v1",
    "kind: Connection",
    "id: erp",
    "connector: sqlserver",
    "connectivity: private",
    "settings:",
    "  server: erp-sql01.corp.local",
    "  user: ingest_reader",
    "  password: ${secret:erp-sql-password}",
    "",
  ].join("\n"),
  "flow.yaml":
    "apiVersion: ingestron.io/v1\nkind: Flow\nid: erp\nsource: erp\ntables:\n  invoices: { object: erp.dbo.Invoices, contract: invoices }\n",
  "invoices.yaml": [
    "apiVersion: v3.1.0",
    "kind: DataContract",
    "id: invoices",
    "version: 1.0.0",
    "status: active",
    "schema:",
    "  - name: invoices",
    "    logicalType: object",
    "    properties:",
    "      - { name: invoice_id, logicalType: integer, required: true, primaryKey: true }",
    "      - { name: amount, logicalType: number }",
    "      - { name: modified_at, logicalType: timestamp }",
    "",
  ].join("\n"),
};

export function generate(changes: Record<string, string> = {}, environment = "dev") {
  const result = resolveDefinitions(memoryFiles({ ...base, ...changes }), {
    packs: [store, adf],
    environment,
  });
  return { result, files: result.model ? adf.build(result.model) : {} };
}

export const json = (files: Record<string, string>, path: string) =>
  JSON.parse(files[path] ?? "null");
