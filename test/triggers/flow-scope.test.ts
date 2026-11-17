// What the pack refuses about a flow's triggers as a whole: a dependency on a tumbling window
// this pack does not write, and a flow whose copies need more than one pipeline.
import { describe, expect, it } from "vitest";
import type { ResolvedModel } from "@ingestron/definitions";
import { adf } from "../../src/index.js";
import { errors, hourly, modelOf, withTriggers } from "./flows.js";

/** The model of flow `b` with its hourly window depending on `target` instead of itself. */
function dependingOn(target: string): ResolvedModel {
  const model = modelOf(withTriggers(hourly).result);
  return {
    ...model,
    tables: model.tables.map((table) => ({
      ...table,
      ingest: table.ingest && {
        ...table.ingest,
        triggers: table.ingest.triggers?.map((trigger) => ({
          ...trigger,
          depends_on: [{ trigger: target, offset: "-1h" }],
        })),
      },
    })),
  };
}

describe("a dependency on a tumbling window", () => {
  it("is refused when this pack does not write that window", () => {
    expect(adf.check!(dependingOn("synapse_flow/hourly"))).toContain(
      '"b/hourly" depends on "synapse_flow/hourly", which this pack does not generate; a tumbling window can depend only on another of this factory\'s tumbling windows',
    );
  });

  it("does not write the trigger whose dependency it cannot name", () => {
    const files = adf.build(dependingOn("synapse_flow/hourly"));
    const triggers = Object.keys(files).filter((path) => path.startsWith("trigger/tr_erp_erp_b"));
    expect(triggers).toEqual([]);
    expect(JSON.stringify(files)).not.toContain("synapse_flow/hourly");
  });

  it("names a window this pack writes by its trigger's name", () => {
    const model = dependingOn("b/hourly");
    expect(adf.check!(model)).toEqual([]);
    const files = adf.build(model);
    const written = JSON.parse(files["trigger/tr_erp_erp_b_hourly_h1.json"]!);
    expect(written.properties.typeProperties.dependsOn).toEqual([
      { type: "SelfDependencyTumblingWindowTriggerReference", offset: "-01:00:00" },
    ]);
  });
});

describe("a flow whose tables are in more than one database", () => {
  const flow = (ingest: string) =>
    `apiVersion: ingestron.io/v1\nkind: Flow\nid: b\nsource: erp\ningest:\n${ingest}\ntables:\n` +
    "  credits: { object: erp.dbo.Credits, contract: invoices }\n" +
    "  refunds: { object: sales.dbo.Refunds, contract: invoices }\n";

  it("is refused when it writes its own triggers", () => {
    const { result } = withTriggers([], {
      changes: { "flow-b.yaml": flow(`  triggers:\n${hourly.join("\n")}\n`) },
    });
    expect(errors(result)).toContain(
      'The flow "b" copies tables from more than one database and writes its own triggers; split it into one flow per database.',
    );
  });

  it("is kept with the default trigger", () => {
    const { result, files } = withTriggers([], { changes: { "flow-b.yaml": flow("  with: {}") } });
    expect(errors(result)).toEqual([]);
    expect(Object.keys(files).filter((path) => path.startsWith("pipeline/pl_erp_"))).toEqual(
      expect.arrayContaining(["pipeline/pl_erp_erp.json", "pipeline/pl_erp_erp_sales.json"]),
    );
  });
});
