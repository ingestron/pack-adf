// The standard's operations policy as the trigger's retries and the Copy activity's timeout.
import { describe, expect, it } from "vitest";
import { generate, pipeline, standardWith, withLines } from "./intent-helpers.js";
import { json } from "./erp.js";

describe("operations from the standard", () => {
  const trigger = (files: Record<string, string>) =>
    json(files, "trigger/tr_erp_erp.json").properties.typeProperties.retryPolicy;

  it("sets the trigger's retries", () => {
    const { result, files } = generate({
      "standard.yaml": standardWith(["operations:", "  retries: { count: 3, interval: 5m }"]),
    });
    expect(result.diagnostics.filter((item) => item.code !== "NOT_APPLIED")).toEqual([]);
    expect(trigger(files)).toEqual({ count: 3, intervalInSeconds: 300 });
  });

  it("keeps the retries setting over the policy", () => {
    const { files } = generate({
      "standard.yaml": withLines(
        ["retries: 4"],
        standardWith(["operations:", "  retries: { count: 3, interval: 5m }"]),
      ),
    });
    expect(trigger(files).count).toBe(4);
  });

  it("keeps two retries without either", () => {
    expect(trigger(generate().files).count).toBe(2);
  });

  it("sets the Copy activity's timeout, in ADF's form", () => {
    const { result, files } = generate({
      "standard.yaml": standardWith(["operations:", "  timeout: 2h"]),
    });
    expect(result.diagnostics.filter((item) => item.code !== "NOT_APPLIED")).toEqual([]);
    expect(pipeline(files).properties.activities[0].policy).toEqual({ timeout: "0.02:00:00" });
  });

  it("raises a timeout below ten minutes to ADF's minimum", () => {
    const { files } = generate({
      "standard.yaml": standardWith(["operations:", "  timeout: 5m"]),
    });
    expect(pipeline(files).properties.activities[0].policy).toEqual({ timeout: "0.00:10:00" });
  });

  it("keeps the activity's own timeout over the policy", () => {
    const { files } = generate({
      "standard.yaml": withLines(
        ["activity: { timeout: 30 }"],
        standardWith(["operations:", "  timeout: 2h"]),
      ),
    });
    expect(pipeline(files).properties.activities[0].policy).toEqual({ timeout: "0.00:30:00" });
  });

  it("does not split a pipeline whose tables spell the default retries differently", () => {
    const two =
      "apiVersion: ingestron.io/v1\nkind: Flow\nid: erp\nsource: erp\ntables:\n  invoices: { object: erp.dbo.Invoices, contract: invoices }\n  refunds: { object: erp.dbo.Refunds, contract: invoices, ingest: { with: { retries: 2 } } }\n";
    const { result } = generate({ "flow.yaml": two });
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });
});
