// after_copy: the Container Apps job ADF starts after each schedule's copies.
import { describe, expect, it } from "vitest";
import { base, generate, withAfterCopy } from "./erp.js";

const job = "/subscriptions/0000/resourceGroups/rg/providers/Microsoft.App/jobs/sales-job";

const errors = (changes: Record<string, string>) =>
  generate(changes)
    .result.diagnostics.filter((item) => item.severity === "error")
    .map(({ code, message }) => ({ code, message }));

describe("after_copy", () => {
  it("accepts a Container Apps job resource ID", () => {
    expect(errors({ "standard.yaml": withAfterCopy(`{ job: "${job}" }`) })).toEqual([]);
  });

  it("refuses a job that is not a Container Apps job resource ID", () => {
    const found = errors({ "standard.yaml": withAfterCopy("{ job: sales-job }") });
    expect(found).toHaveLength(1);
    expect(found[0]?.code).toBe("METHOD_CHECK");
    expect(found[0]?.message).toContain(
      "after_copy.job must be a Container Apps job resource ID, /subscriptions/<id>/resourceGroups/<group>/providers/Microsoft.App/jobs/<name>",
    );
  });

  it("refuses tables with different after_copy", () => {
    const crm = base["erp.yaml"]!.replace("id: erp", "id: crm");
    const flow =
      "apiVersion: ingestron.io/v1\nkind: Flow\nid: crm\nsource: crm\ningest: { with: { after_copy: { job: /subscriptions/1/resourceGroups/rg/providers/Microsoft.App/jobs/other } } }\ntables:\n  accounts: { object: crm.dbo.Accounts, contract: invoices }\n";
    const found = errors({
      "standard.yaml": withAfterCopy(`{ job: "${job}" }`),
      "crm.yaml": crm,
      "crm-flow.yaml": flow,
    });
    expect(found.map(({ message }) => message).join("\n")).toContain(
      "every ADF table must use the same after_copy",
    );
  });

  it("generates as before without after_copy", () => {
    expect(generate().files).toMatchSnapshot();
  });
});
