// Intent (spec/behaviour.md, section "Intent"): what the pack declares it applies, the
// settings that are other names for intent, and the Platform section.
import { intentCoverageGaps, intentUseOf } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { adf } from "../src/index.js";
import { base } from "./erp.js";
import { flowWith, generate, salesforce, withLines } from "./intent-helpers.js";

describe("the pack's intent coverage", () => {
  it("covers every intent path and value", () => {
    expect(intentCoverageGaps(adf)).toEqual([]);
  });

  it("declares what it builds as used, with the date its status was checked", () => {
    for (const key of [
      "load.mode=full",
      "load.mode=files",
      "load.mode=incremental",
      "load.cursor",
      "audit=run_id",
      "audit=window_start",
      "audit=window_end",
      "audit=source_object",
      "audit=source_connection",
      "audit=loaded_at",
      "operations.retries",
      "operations.timeout",
      "operations.schedule=project",
    ]) {
      const use = adf.intent?.[key];
      expect(use, key).toMatchObject({
        use: "used",
        status: { level: "ga", checked: "2026-11-09" },
      });
    }
  });

  it("plans a schedule per flow and deletes on the tables it ends at", () => {
    const planned = { use: "not-yet", reason: "Planned." };
    expect(intentUseOf(adf, "operations.schedule", "flow")).toEqual(planned);
    expect(intentUseOf(adf, "load.deletes.when")).toEqual(planned);
    expect(intentUseOf(adf, "load.deletes.mode", "soft")).toEqual(planned);
  });

  it("leaves what a store keeps to the store, and says so when nothing does", () => {
    for (const key of [
      "history",
      "sequence",
      "rescued",
      "retention.time_travel",
      "retention.log",
      "storage.clustering",
      "storage.features",
      "quality.results",
    ])
      expect(adf.intent?.[key], key).toEqual({
        use: "not-applicable",
        reason: "ADF only lands files; nothing keeps the table.",
      });
  });
});

describe("checking and cleansing", () => {
  it("leaves them to the table that reads the landed files", () => {
    const reason =
      "The files are landed as the source gives them; check and cleanse them in the table that reads them.";
    const checks: [string, string?][] = [
      ["quality.rules", "notNull"],
      ["quality.rules", "pattern"],
      ["quality.actions", "warn"],
      ["quality.actions", "drop"],
      ["quality.actions", "fail"],
      ["quality.table-checks", "true"],
      ["quality.quarantine", "true"],
      ["cleanse.trim", "true"],
      ["cleanse.empty", "true"],
      ["cleanse.map", "true"],
      ["cleanse.case", "true"],
      ["cleanse.default", "true"],
      ["cleanse.timezone", "true"],
      ["deduplicate", "true"],
    ];
    for (const [path, value] of checks)
      expect(intentUseOf(adf, path, value), `${path}=${value}`).toEqual({
        use: "not-applicable",
        reason,
      });
  });
});

describe("load intent and the mode settings", () => {
  it("builds the same pipeline from load intent as from the settings", () => {
    const fromSettings = generate({
      "standard.yaml": withLines(["mode: incremental", "watermark_column: modified_at"]),
    });
    const fromIntent = generate({
      "flow.yaml": flowWith(", load: { mode: incremental, cursor: modified_at }"),
    });
    // The settings are now other names for intent, which the core says once.
    expect(fromSettings.result.diagnostics.filter((item) => item.code !== "SETTING_MOVED")).toEqual(
      [],
    );
    expect(fromIntent.result.diagnostics).toEqual([]);
    expect(fromIntent.files).toEqual(fromSettings.files);
    expect(fromIntent.files).not.toEqual(generate().files);
  });

  it("takes the setting's mode as load intent", () => {
    const { result } = generate({
      "standard.yaml": withLines(["mode: incremental", "watermark_column: modified_at"]),
    });
    const table = result.model!.tables[0]!;
    expect(table.intent.load).toEqual({ mode: "incremental", cursor: "modified_at" });
  });

  it("defaults a table to a full load", () => {
    const { result } = generate();
    expect(result.model!.tables[0]!.intent.load?.mode).toBe("full");
  });

  it("defaults adf-table to a full load and adf-files to files", () => {
    const table = generate(salesforce());
    expect(table.result.model?.tables[0]?.intent.load?.mode).toBe("full");
    const files = generate({
      "standard.yaml": base["standard.yaml"]!.replace("adf-copy:", "adf-files:\n      format: csv"),
      "erp.yaml":
        "apiVersion: ingestron.io/v1\nkind: Connection\nid: erp\nconnector: amazon-s3\nconnectivity: private\nsettings:\n  access_key: synthetic-access\n  secret_key: ${secret:s3-key}\n",
      "flow.yaml": base["flow.yaml"]!.replace("erp.dbo.Invoices", "sales/orders"),
    });
    expect(files.result.model?.tables[0]?.intent.load?.mode).toBe("files");
  });
});

describe("judging", () => {
  it("warns of history on a table that ends at the landed files, and not on a stored one", () => {
    const flow = flowWith(", history: full");
    const stored = generate({ "flow.yaml": flow });
    expect(stored.result.diagnostics.filter((item) => item.code === "NOT_APPLIED")).toEqual([]);
    const landed = generate({
      "flow.yaml": flow,
      "standard.yaml": `${base["standard.yaml"]}store: { default: none }\n`,
    });
    expect(landed.result.diagnostics.map((item) => item.message)).toContain(
      "history: full isn't applied on adf: ADF only lands files; nothing keeps the table.",
    );
  });
});

describe("the platform section", () => {
  const platform = (section: string) => ({
    "platform.yaml": `apiVersion: ingestron.io/v1\nkind: Platform\nid: lake\n${section}\n`,
  });

  it("accepts an empty adf section", () => {
    expect(generate(platform("adf: {}")).result.diagnostics).toEqual([]);
  });

  it("refuses any key in it", () => {
    const { result } = generate(platform("adf: { region: uksouth }"));
    expect(result.diagnostics.map((item) => item.code)).toContain("BAD_SETTING");
  });
});
