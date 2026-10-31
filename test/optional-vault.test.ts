import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { base, generate } from "./erp.js";
const cases = JSON.parse(
  readFileSync(new URL("../spec/conformance/optional-vault.json", import.meta.url), "utf8"),
) as { name: string; connector: string; settings: Record<string, unknown>; valid: boolean }[];
for (const row of cases)
  it(row.name, () => {
    const { result, files } = generate({
      "standard.yaml": base["standard.yaml"]!.replace(
        "adf-copy:",
        "adf-files:\n      format: csv\n      mode: all\n      files: fixture.csv",
      ).replace("      key_vault: https://kv-erp.vault.azure.net\n", ""),
      "erp.yaml": JSON.stringify({
        apiVersion: "ingestron.io/v1",
        kind: "Connection",
        id: "erp",
        connector: row.connector,
        connectivity: "public",
        settings: row.settings,
      }),
      "flow.yaml": base["flow.yaml"]!.replace("erp.dbo.Invoices", "synthetic/input").replace(
        "source: erp\n",
        "source: erp\ningest: { uses: adf-files }\n",
      ),
    });
    expect(Boolean(result.model), JSON.stringify(result.diagnostics)).toBe(row.valid);
    if (!row.valid) expect(JSON.stringify(result.diagnostics)).toContain("key_vault");
    if (row.valid) {
      expect(Object.keys(files).some((path) => path.includes("keyvault"))).toBe(false);
      expect(JSON.stringify(files)).not.toContain("undefined");
    }
  });
