// A column named differently at the source, through the ADF copy.
import { describe, expect, it } from "vitest";
import { base, generate, json } from "./erp.js";

describe("physical names", () => {
  it("selects a source column under its contract name, so the files need no renaming", () => {
    const contract = base["invoices.yaml"]!.replace(
      "{ name: amount, logicalType: number }",
      "{ name: amount, logicalType: number, physicalName: amt }",
    );
    const { result, files } = generate({ "invoices.yaml": contract });
    expect(result.diagnostics).toEqual([]);
    const pipeline = json(files, "pipeline/pl_erp_erp.json");
    expect(pipeline.properties.activities[0].typeProperties.source.sqlReaderQuery).toBe(
      "SELECT [invoice_id], [amt] AS [amount], [modified_at] FROM [dbo].[Invoices]",
    );
  });
});
