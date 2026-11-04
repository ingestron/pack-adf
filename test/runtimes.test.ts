// The factory's Git folder holds each integration runtime its linked services use,
// so Microsoft's export keeps their connectVia and its post-deployment script keeps
// the runtime.
import { describe, expect, it } from "vitest";
import { base, generate, json } from "./erp.js";

const withRuntime = (name: string, kind: string) => ({
  "standard.yaml": base["standard.yaml"]!.replace(
    "      integration_runtime: shir-erp\n",
    `      integration_runtime: ${name}\n      runtime_kind: ${kind}\n`,
  ),
});

describe("integration runtimes", () => {
  it("writes a self-hosted runtime by name and type only", () => {
    expect(json(generate().files, "integrationRuntime/shir-erp.json")).toEqual({
      name: "shir-erp",
      properties: { type: "SelfHosted" },
    });
  });

  it("writes a named Azure runtime as a managed runtime that resolves its region", () => {
    const { files } = generate(withRuntime("ir-azure", "azure"));
    expect(json(files, "integrationRuntime/ir-azure.json")).toEqual({
      name: "ir-azure",
      properties: {
        type: "Managed",
        typeProperties: { computeProperties: { location: "AutoResolve" } },
      },
    });
  });

  it("never writes ADF's default Azure runtime", () => {
    const { files } = generate(withRuntime("AutoResolveIntegrationRuntime", "azure"));
    expect(Object.keys(files).filter((path) => path.startsWith("integrationRuntime/"))).toEqual([]);
  });

  it("refuses one runtime name used with two kinds", () => {
    const { result } = generate({
      ...withRuntime("shared-ir", "self-hosted"),
      "crm.yaml": base["erp.yaml"]!.replace("id: erp", "id: crm"),
      "crm-flow.yaml":
        "apiVersion: ingestron.io/v1\nkind: Flow\nid: crm\nsource: crm\ningest: { with: { runtime_kind: azure } }\ntables:\n  accounts: { object: crm.dbo.Accounts, contract: invoices }\n",
    });
    const messages = result.diagnostics.map((item) => item.message).join("\n");
    expect(messages).toContain(
      "ADF integration runtime shared-ir is used as azure and as self-hosted; give each runtime one runtime_kind",
    );
  });
});
