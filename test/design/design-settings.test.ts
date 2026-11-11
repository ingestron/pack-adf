// The ADF design settings: pattern, parallel, activity policy, audit columns,
// folder and annotations, and the problems they are checked for.
import { describe, expect, it } from "vitest";
import { base, generate } from "../erp.js";
import { tableProject } from "../table-project.js";

const design = (lines: string[]) =>
  base["standard.yaml"]!.replace(
    "      start: 2026-10-01T00:00:00Z\n",
    `      start: 2026-10-01T00:00:00Z\n${lines.map((line) => `      ${line}`).join("\n")}\n`,
  );

const messages = (lines: string[]) =>
  generate({ "standard.yaml": design(lines) }).result.diagnostics.map(
    (diagnostic) => diagnostic.message,
  );

describe("ADF design settings", () => {
  it("accepts the full design block", () => {
    expect(
      messages([
        "pattern: foreach",
        "parallel: 4",
        "activity: { retries: 2, retry_interval: 60, timeout: 120 }",
        "audit_columns:",
        "  _loaded_at: run.trigger_time",
        "  _run_id: run.id",
        "  _source: source.object",
        "  _environment: ${environment.name}",
        "folder: ingestron/${project.id}",
        "annotations: [erp]",
      ]),
    ).toEqual([]);
  });

  it("refuses an unknown run value", () => {
    const found = messages(["audit_columns: { _x: run.started }"]).join("\n");
    expect(found).toContain('"run.started"');
    expect(found).toContain("run.trigger_time");
  });

  it("refuses a column name that is not a name", () => {
    expect(messages(['audit_columns: { "1st": run.id }']).join("\n")).toContain("1st");
  });

  it("refuses an audit column that is a column of the contract", () => {
    expect(messages(["audit_columns: { AMOUNT: run.id }"]).join("\n")).toContain(
      'audit column "AMOUNT" is in the contract or the source metadata; rename it',
    );
  });

  it("refuses a literal ADF would read as an expression", () => {
    expect(messages(['audit_columns: { _x: "@pipeline().RunId" }']).join("\n")).toContain(
      "ADF reads as an expression",
    );
    expect(messages(['audit_columns: { _x: "a@{b}" }']).join("\n")).toContain(
      "ADF reads as an expression",
    );
  });

  it("refuses out-of-range numbers", () => {
    expect(messages(["parallel: 0"])).not.toEqual([]);
    expect(messages(["parallel: 51"])).not.toEqual([]);
    expect(messages(["activity: { retries: 11 }"])).not.toEqual([]);
    expect(messages(["activity: { retry_interval: 10 }"])).not.toEqual([]);
    expect(messages(["activity: { timeout: 0 }"])).not.toEqual([]);
  });

  it("refuses an activity timeout under ADF's minimum of 10 minutes", () => {
    expect(messages(["activity: { timeout: 9 }"])).not.toEqual([]);
    expect(messages(["activity: { timeout: 10 }"])).toEqual([]);
  });

  it("refuses parallel without the foreach pattern", () => {
    expect(messages(["parallel: 8"]).join("\n")).toContain("parallel applies to pattern: foreach");
  });
});

describe("ADF design settings by method", () => {
  const s3 = (extra: string) => ({
    "standard.yaml": base["standard.yaml"]!.replace(
      "adf-copy:",
      `adf-files:\n      format: csv\n      ${extra}`,
    ),
    "erp.yaml":
      "apiVersion: ingestron.io/v1\nkind: Connection\nid: erp\nconnector: amazon-s3\nconnectivity: private\nsettings:\n  access_key: synthetic-access\n  secret_key: ${secret:s3-key}\n",
    "flow.yaml": base["flow.yaml"]!.replace("erp.dbo.Invoices", "sales/orders"),
  });

  it("refuses audit columns on files copied as they are", () => {
    const { result } = generate(s3("audit_columns: { _run_id: run.id }"));
    expect(result.diagnostics.map((item) => item.message).join("\n")).toContain("audit_columns");
  });

  it("accepts an activity policy on files copied as they are", () => {
    const { result } = generate(s3("activity: { retries: 2 }"));
    expect(result.diagnostics).toEqual([]);
  });

  it("refuses foreach on adf-table", () => {
    const project = tableProject("rest", "  url: https://source.example.test", "orders");
    project["standard.yaml"] += "      pattern: foreach\n";
    const { result } = generate(project);
    expect(result.diagnostics.map((item) => item.message).join("\n")).toContain(
      "pattern: foreach is offered for adf-copy, not adf-table",
    );
  });
});

describe("audit column names the store packs need apart", () => {
  it("refuses two names that differ only by case", () => {
    expect(messages(["audit_columns: { _run: run.id, _RUN: run.pipeline }"]).join("\n")).toContain(
      'audit columns "_run" and "_RUN" differ only by case',
    );
  });

  it("refuses names the packs that read the files add", () => {
    expect(messages(["audit_columns: { _ingestron_file: run.id }"]).join("\n")).toContain(
      '"_ingestron_file" is a name the packs that read the files use',
    );
    expect(messages(["audit_columns: { _RESCUED_DATA: run.id }"]).join("\n")).toContain(
      "is a name the packs that read the files use",
    );
  });
});
