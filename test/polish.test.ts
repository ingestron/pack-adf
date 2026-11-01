// Landing paths ADF would misread, a flow's path over a standard's layout,
// and after_copy's names, IDs and timeouts.
import { describe, expect, it } from "vitest";
import { pathProblems } from "../src/layout.js";
import { base, generate, json, withAfterCopy } from "./erp.js";
import { tableProject } from "./table-project.js";

const job =
  "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.App/jobs/sales-job";
const errors = (changes: Record<string, string>) =>
  generate(changes)
    .result.diagnostics.filter((item) => item.severity === "error")
    .map(({ message }) => message);

describe("path patterns ADF would misread", () => {
  it.each([
    [
      "/{object}/{object}.parquet",
      'the path pattern "/{object}/{object}.parquet" must not start with /',
    ],
    [
      "{object}//{object}.parquet",
      'the path pattern "{object}//{object}.parquet" has an empty folder name',
    ],
    [
      "{object}/../{object}.parquet",
      'the path pattern "{object}/../{object}.parquet" must not use . or .. as a folder',
    ],
    [
      "{object}/x}.parquet",
      'the path pattern "{object}/x}.parquet" has a brace that is not part of a {token}',
    ],
    [
      "@{object}/{object}.parquet",
      'the path pattern "@{object}/{object}.parquet" has a name starting with @, which ADF reads as an expression',
    ],
  ])("refuses %s", (path, message) => {
    expect(pathProblems(path, "parquet")).toContain(message);
  });

  it("refuses an object starting with @", () => {
    const flow = base["flow.yaml"]!.replace("erp.dbo.Invoices", '"@erp.dbo.Invoices"');
    expect(errors({ "flow.yaml": flow }).join("\n")).toContain(
      'the object "@erp.dbo.Invoices" has a name starting with @, which ADF reads as an expression',
    );
  });
});

describe("a flow's path and a standard's layout", () => {
  it("uses the flow's path over the standard's layout", () => {
    const standard = base["standard.yaml"]!.replace(
      "      start: 2026-10-01T00:00:00Z\n",
      "      start: 2026-10-01T00:00:00Z\n      layout: increments\n",
    );
    const flow = base["flow.yaml"]!.replace(
      "source: erp\n",
      'source: erp\ningest: { with: { path: "{object}/{yyyy}/{object}_{run}.parquet" } }\n',
    );
    expect(errors({ "standard.yaml": standard, "flow.yaml": flow })).toEqual([]);
    const copy = json(
      generate({ "standard.yaml": standard, "flow.yaml": flow }).files,
      "pipeline/pl_erp_erp.json",
    ).properties.activities[0];
    expect(copy.outputs[0].parameters.file).toBe("erp.dbo.Invoices_@{pipeline().RunId}.parquet");
  });
});

describe("after_copy", () => {
  it.each([
    ["/subscriptions/0000/resourceGroups/rg/providers/Microsoft.App/jobs/j"],
    [
      "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/r'g/providers/Microsoft.App/jobs/j",
    ],
  ])("refuses the job %s", (id) => {
    expect(errors({ "standard.yaml": withAfterCopy(`{ job: "${id}" }`) }).join("\n")).toContain(
      "after_copy.job must be a Container Apps job resource ID",
    );
  });

  it.each(["00:99:00", "00:00:00", "91.00:00:00"])("refuses the timeout %s", (timeout) => {
    expect(
      errors({ "standard.yaml": withAfterCopy(`{ job: "${job}", timeout: "${timeout}" }`) }).join(
        "\n",
      ),
    ).toContain(
      `after_copy.timeout "${timeout}" must be more than zero and at most 90 days, as [d.]hh:mm:ss`,
    );
  });

  it("names a second parent on the same schedule by its start", () => {
    const crm = base["erp.yaml"]!.replace("id: erp", "id: crm");
    const flow =
      "apiVersion: ingestron.io/v1\nkind: Flow\nid: crm\nsource: crm\ningest: { with: { start: 2026-11-01T00:00:00Z } }\ntables:\n  accounts: { object: crm.dbo.Accounts, contract: invoices }\n";
    const { files } = generate({
      "standard.yaml": withAfterCopy(`{ job: "${job}" }`),
      "crm.yaml": crm,
      "crm-flow.yaml": flow,
    });
    expect(
      Object.keys(files)
        .filter((path) => path.startsWith("trigger/"))
        .sort(),
    ).toEqual([
      "trigger/tr_erp_every_24_hour.json",
      "trigger/tr_erp_every_24_hour_from_20261101.json",
    ]);
  });

  it("makes one parent when tables differ only in retries", () => {
    const crm = base["erp.yaml"]!.replace("id: erp", "id: crm");
    const flow =
      "apiVersion: ingestron.io/v1\nkind: Flow\nid: crm\nsource: crm\ningest: { with: { retries: 5 } }\ntables:\n  accounts: { object: crm.dbo.Accounts, contract: invoices }\n";
    const { files } = generate({
      "standard.yaml": withAfterCopy(`{ job: "${job}" }`),
      "crm.yaml": crm,
      "crm-flow.yaml": flow,
    });
    expect(Object.keys(files).filter((path) => path.startsWith("trigger/"))).toEqual([
      "trigger/tr_erp_every_24_hour.json",
    ]);
    const copy = json(files, "pipeline/pl_erp_crm.json").properties.activities.find(
      (activity: { type: string }) => activity.type === "Copy",
    );
    expect(copy.policy.retry).toBe(5);
  });

  it("keeps activity names within ADF's 55 characters", () => {
    const long = "a_connection_with_a_very_long_name_indeed";
    const crm = base["erp.yaml"]!.replace("id: erp", `id: ${long}`);
    const flow = `apiVersion: ingestron.io/v1\nkind: Flow\nid: crm\nsource: ${long}\ntables:\n  accounts: { object: crm.dbo.Accounts, contract: invoices }\n`;
    const { files } = generate({
      "standard.yaml": withAfterCopy(`{ job: "${job}" }`),
      "crm.yaml": crm,
      "crm-flow.yaml": flow,
    });
    const names = json(files, "pipeline/pl_erp_every_24_hour.json").properties.activities.map(
      (activity: { name: string }) => activity.name,
    );
    expect(
      names.every((name: string) => name.length <= 55),
      names.join(", "),
    ).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it("refuses a parent name that a connection's pipeline already has", () => {
    const clash = base["erp.yaml"]!.replace("id: erp", "id: every_24_hour");
    const flow =
      "apiVersion: ingestron.io/v1\nkind: Flow\nid: clash\nsource: every_24_hour\ntables:\n  accounts: { object: every_24_hour.dbo.Accounts, contract: invoices }\n";
    expect(
      errors({
        "standard.yaml": withAfterCopy(`{ job: "${job}" }`),
        "clash.yaml": clash,
        "clash-flow.yaml": flow,
      }).join("\n"),
    ).toContain(
      'after_copy\'s parent pipeline "pl_erp_every_24_hour" has the name of a generated pipeline',
    );
  });

  it("replaces the trigger of files copied as they are", () => {
    const standard = withAfterCopy(`{ job: "${job}" }`).replace(
      "adf-copy:",
      "adf-files:\n      format: csv",
    );
    const erp =
      "apiVersion: ingestron.io/v1\nkind: Connection\nid: erp\nconnector: amazon-s3\nconnectivity: private\nsettings:\n  access_key: synthetic-access\n  secret_key: ${secret:s3-key}\n";
    const flow = base["flow.yaml"]!.replace("erp.dbo.Invoices", "sales/orders");
    const { result, files } = generate({
      "standard.yaml": standard,
      "erp.yaml": erp,
      "flow.yaml": flow,
    });
    expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
    expect(Object.keys(files).filter((path) => path.startsWith("trigger/"))).toEqual([
      "trigger/tr_erp_every_24_hour.json",
    ]);
    expect(json(files, "pipeline/pl_erp_every_24_hour.json").properties.activities[0].name).toBe(
      "run_pl_erp_erp",
    );
  });

  it("replaces the trigger of a native table copy", () => {
    const project = tableProject(
      "salesforce",
      "  url: https://synthetic.my.salesforce.com\n  client_id: synthetic-client\n  client_secret: ${secret:salesforce-client}\n  api_version: '60.0'",
      "Account",
    );
    project["standard.yaml"] = project["standard.yaml"]!.replace(
      "      start: 2026-10-01T00:00:00Z\n",
      `      start: 2026-10-01T00:00:00Z\n      after_copy: { job: "${job}" }\n`,
    );
    const { result, files } = generate(project);
    expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
    expect(Object.keys(files).filter((path) => path.startsWith("trigger/"))).toEqual([
      "trigger/tr_erp_every_24_hour.json",
    ]);
  });
});
