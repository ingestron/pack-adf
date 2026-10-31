import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { base, generate } from "./erp.js";
const cases = JSON.parse(
  readFileSync(new URL("../spec/conformance/default-file-runtime.json", import.meta.url), "utf8"),
) as { kind: string; name: string; explicit: boolean }[];
for (const row of cases)
  it(`uses ${row.explicit ? "the named" : "the implicit default"} ${row.kind} runtime ${row.name}`, () => {
    const { result, files } = generate({
      "standard.yaml": base["standard.yaml"]!.replace(
        "adf-copy:",
        "adf-files:\n      format: csv\n      mode: all",
      ).replace(
        "integration_runtime: shir-erp",
        `integration_runtime: ${row.name}\n      runtime_kind: ${row.kind}`,
      ),
      "erp.yaml": JSON.stringify({
        apiVersion: "ingestron.io/v1",
        kind: "Connection",
        id: "erp",
        connector: "azure-blob",
        connectivity: "public",
        settings: { url: "https://synthetic.blob.core.windows.net" },
      }),
      "flow.yaml": base["flow.yaml"]!.replace("erp.dbo.Invoices", "synthetic/input").replace(
        "source: erp\n",
        "source: erp\ningest: { uses: adf-files }\n",
      ),
    });
    expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
    const service = Object.values(files)
      .map((text) => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      })
      .find((value) => value?.properties?.type === "AzureBlobStorage");
    expect(service).toBeDefined();
    expect(service.properties.connectVia).toEqual(
      row.explicit ? { referenceName: row.name, type: "IntegrationRuntimeReference" } : undefined,
    );
  });
