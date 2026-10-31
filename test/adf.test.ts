// A private SQL Server copied by ADF into the landing folder, then stored by
// another pack: two packs in one standard.
import { describe, expect, it } from "vitest";
import { base, generate, json } from "./erp.js";

describe("choosing ADF for a private source", () => {
  it("copies with ADF, then hands the files to the store pack", () => {
    const table = generate().result.model?.tables[0];
    expect(table?.ingest).toMatchObject({ method: "adf-copy", pack: "adf" });
    expect(table?.store).toMatchObject({ method: "table", pack: "store" });
  });
});

describe("generated ADF resources", () => {
  it("writes one file per resource, in the folders ADF keeps in Git", () => {
    expect(Object.keys(generate().files).sort()).toEqual([
      "dataset/ds_erp_erp_erp.json",
      "dataset/ds_erp_landing.json",
      "linkedService/ls_erp_erp_erp.json",
      "linkedService/ls_erp_keyvault.json",
      "linkedService/ls_erp_landing.json",
      "pipeline/pl_erp_erp.json",
      "trigger/tr_erp_erp.json",
    ]);
  });

  it("connects through the self-hosted integration runtime with the password from Key Vault", () => {
    expect(json(generate().files, "linkedService/ls_erp_erp_erp.json")).toEqual({
      name: "ls_erp_erp_erp",
      properties: {
        type: "SqlServer",
        typeProperties: {
          server: "erp-sql01.corp.local",
          database: "erp",
          encrypt: "mandatory",
          trustServerCertificate: false,
          authenticationType: "SQL",
          userName: "ingest_reader",
          password: {
            type: "AzureKeyVaultSecret",
            store: { referenceName: "ls_erp_keyvault", type: "LinkedServiceReference" },
            secretName: "erp-sql-password",
          },
        },
        connectVia: { referenceName: "shir-erp", type: "IntegrationRuntimeReference" },
      },
    });
    expect(json(generate().files, "linkedService/ls_erp_landing.json").properties).toEqual({
      type: "AzureBlobFS",
      typeProperties: { url: "https://erplake.dfs.core.windows.net" },
    });
  });

  it("copies only the contract's columns into a Parquet file per window", () => {
    const pipeline = json(generate().files, "pipeline/pl_erp_erp.json");
    const copy = pipeline.properties.activities[0];
    expect(copy.name).toBe("copy_invoices");
    expect(copy.typeProperties.source).toEqual({
      type: "SqlSource",
      sqlReaderQuery: "SELECT [invoice_id], [amount], [modified_at] FROM [dbo].[Invoices]",
    });
    expect(copy.typeProperties.sink).toEqual({
      type: "ParquetSink",
      storeSettings: { type: "AzureBlobFSWriteSettings" },
      formatSettings: { type: "ParquetWriteSettings" },
    });
    expect(copy.outputs[0].parameters.folder).toBe("erp/erp.dbo.Invoices");
  });

  it("copies only the window's changes in incremental mode", () => {
    const standard = base["standard.yaml"]!.replace(
      "      start:",
      "      mode: incremental\n      watermark_column: modified_at\n      start:",
    );
    const copy = json(generate({ "standard.yaml": standard }).files, "pipeline/pl_erp_erp.json")
      .properties.activities[0];
    expect(copy.typeProperties.source.sqlReaderQuery).toEqual({
      value:
        "SELECT [invoice_id], [amount], [modified_at] FROM [dbo].[Invoices] WHERE [modified_at] >= '@{formatDateTime(pipeline().parameters.windowStart, 'yyyy-MM-dd HH:mm:ss')}' AND [modified_at] < '@{formatDateTime(pipeline().parameters.windowEnd, 'yyyy-MM-dd HH:mm:ss')}'",
      type: "Expression",
    });
  });

  it("runs on a tumbling window, stopped outside production", () => {
    const dev = json(generate().files, "trigger/tr_erp_erp.json").properties;
    expect(dev).toMatchObject({
      type: "TumblingWindowTrigger",
      runtimeState: "Stopped",
      typeProperties: {
        frequency: "Hour",
        interval: 24,
        startTime: "2026-10-01T00:00:00Z",
        maxConcurrency: 1,
        retryPolicy: { count: 2, intervalInSeconds: 300 },
      },
    });
    expect(
      json(generate({}, "prod").files, "trigger/tr_erp_erp.json").properties.runtimeState,
    ).toBe("Started");
  });

  const platform = (lines: string[]) => ({
    "platform.yaml": [
      "apiVersion: ingestron.io/v1",
      "kind: Platform",
      "id: lake",
      ...lines,
      "",
    ].join("\n"),
  });
  const state = (changes: Record<string, string>) =>
    json(generate(changes, "prod").files, "trigger/tr_erp_erp.json").properties.runtimeState;

  it("is stopped in production when the platform pauses its schedule", () => {
    expect(state(platform(["schedule: { cron: '0 0 * * * ?', paused: true }"]))).toBe("Stopped");
  });

  it("can be paused on its own with the platform's adf-copy setting", () => {
    const changes = platform([
      "schedule: { cron: '0 0 * * * ?' }",
      "settings:",
      "  adf-copy: { paused: true }",
    ]);
    expect(state(changes)).toBe("Stopped");
  });
});

describe("refusals", () => {
  it("refuses a password that is not a secret reference, and incremental mode without a watermark column", () => {
    const standard = base["standard.yaml"]!.replace(
      "      start:",
      "      mode: incremental\n      start:",
    );
    const connection = base["erp.yaml"]!.replace("${secret:erp-sql-password}", "hunter2");
    expect(
      generate({ "standard.yaml": standard, "erp.yaml": connection }).result.diagnostics.map(
        (item) => item.message,
      ),
    ).toEqual([
      '"adf-copy" for table "invoices": the connection\'s password must be ${secret:…}, the name of a Key Vault secret.',
      '"adf-copy" for table "invoices": incremental mode needs "watermark_column".',
    ]);
  });

  it("refuses tables that would need a different Key Vault or landing storage, which one factory set-up cannot hold", () => {
    const second =
      "  refunds:\n    object: erp.dbo.Refunds\n    contract: invoices\n    ingest:\n      with: { key_vault: https://kv-other.vault.azure.net }\n";
    const { result } = generate({ "flow.yaml": base["flow.yaml"] + second });
    expect(result.diagnostics.map((item) => item.message)).toEqual([
      "every ADF table must use the same key_vault and landing storage; refunds differs from invoices.",
    ]);
  });

  it("refuses tables of one source database that would need a different runtime or schedule, which one pipeline and trigger cannot hold", () => {
    const second =
      "  refunds:\n    object: erp.dbo.Refunds\n    contract: invoices\n    ingest:\n      with: { every: { frequency: Minute, interval: 15 } }\n";
    const { result } = generate({ "flow.yaml": base["flow.yaml"] + second });
    expect(result.diagnostics.map((item) => item.message)).toEqual([
      "the adf-copy tables of erp.erp share one linked service, pipeline and trigger, so integration_runtime, runtime_kind, encrypt, every, start, retries and paused must be the same; refunds differs from invoices.",
    ]);
  });
});
