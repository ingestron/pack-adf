// The factory's Git folder holds each integration runtime its linked services use,
// as the definitions describe it, so Microsoft's export keeps their connectVia and
// its post-deployment script keeps the runtime.
import { describe, expect, it } from "vitest";
import { adf } from "../src/index.js";
import { base, generate, json } from "./erp.js";

const shared =
  "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-shared/providers/Microsoft.DataFactory/factories/adf-shared/integrationruntimes/shir-erp";

/** The ERP standard with the runtime's name, kind and, as YAML, its description. */
const withRuntime = (name: string, kind: string, runtime?: string) => ({
  "standard.yaml": base["standard.yaml"]!.replace(
    "      integration_runtime: shir-erp\n",
    `      integration_runtime: ${name}\n      runtime_kind: ${kind}\n${runtime ? `      runtime: ${runtime}\n` : ""}`,
  ),
});

const messages = (changes: Record<string, string>) =>
  generate(changes)
    .result.diagnostics.map((item) => item.message)
    .join("\n");

describe("integration runtimes", () => {
  it("writes a self-hosted runtime of the factory's own by name and type only", () => {
    expect(json(generate().files, "integrationRuntime/shir-erp.json")).toEqual({
      name: "shir-erp",
      properties: { type: "SelfHosted" },
    });
  });

  it("writes a linked self-hosted runtime with the shared runtime it links to", () => {
    const { files } = generate(withRuntime("shir-erp", "self-hosted", `{ shared: '${shared}' }`));
    expect(json(files, "integrationRuntime/shir-erp.json").properties).toEqual({
      type: "SelfHosted",
      typeProperties: { linkedInfo: { authorizationType: "RBAC", resourceId: shared } },
    });
  });

  it("writes a named Azure runtime that resolves its region, without data flow compute", () => {
    const { files } = generate(withRuntime("ir-azure", "azure"));
    expect(json(files, "integrationRuntime/ir-azure.json")).toEqual({
      name: "ir-azure",
      properties: {
        type: "Managed",
        typeProperties: { computeProperties: { location: "AutoResolve" } },
      },
    });
    expect(files["managedVirtualNetwork/default.json"]).toBeUndefined();
  });

  it("writes an Azure runtime's region, data flow compute and managed virtual network", () => {
    const runtime =
      "{ location: UK South, managed_virtual_network: true, data_flow: { compute_type: MemoryOptimized, core_count: 16, time_to_live: 10 } }";
    const { files } = generate(withRuntime("ir-azure", "azure", runtime));
    expect(json(files, "integrationRuntime/ir-azure.json").properties).toEqual({
      type: "Managed",
      typeProperties: {
        computeProperties: {
          location: "UK South",
          dataFlowProperties: { computeType: "MemoryOptimized", coreCount: 16, timeToLive: 10 },
        },
      },
      managedVirtualNetwork: { type: "ManagedVirtualNetworkReference", referenceName: "default" },
    });
    expect(json(files, "managedVirtualNetwork/default.json")).toEqual({
      name: "default",
      properties: {},
    });
  });

  it("never writes ADF's default Azure runtime", () => {
    const { files } = generate(withRuntime("AutoResolveIntegrationRuntime", "azure"));
    expect(Object.keys(files).filter((path) => path.startsWith("integrationRuntime/"))).toEqual([]);
  });

  it("refuses a runtime name ADF does not accept", () => {
    expect(messages(withRuntime("shir_erp", "self-hosted"))).toContain("integration_runtime");
    expect(generate(withRuntime("shir_erp", "self-hosted")).result.model).toBeUndefined();
  });

  it("refuses settings of the other kind of runtime", () => {
    expect(messages(withRuntime("ir-azure", "azure", `{ shared: '${shared}' }`))).toContain(
      "runtime.shared links a self-hosted runtime; it needs runtime_kind: self-hosted",
    );
    expect(messages(withRuntime("shir-erp", "self-hosted", "{ location: UK South }"))).toContain(
      "runtime.location describes an Azure runtime; it needs runtime_kind: azure",
    );
    expect(
      messages(
        withRuntime(
          "shir-erp",
          "self-hosted",
          "{ managed_virtual_network: true, data_flow: { core_count: 16 } }",
        ),
      ),
    ).toContain(
      "runtime.managed_virtual_network, runtime.data_flow describe an Azure runtime; they need runtime_kind: azure",
    );
  });

  it("refuses a region's short name, which Microsoft's export rewrites only when it is the same everywhere", () => {
    expect(messages(withRuntime("ir-azure", "azure", "{ location: uksouth }"))).toContain(
      "runtime.location \"uksouth\" is a region's short name; use its display name, with capitals and spaces, as Data Factory writes it: Microsoft's export rewrites a short name only where every environment has the same region",
    );
  });

  it("refuses one runtime name described in two ways", () => {
    const text = messages({
      ...withRuntime("shared-ir", "self-hosted"),
      "crm.yaml": base["erp.yaml"]!.replace("id: erp", "id: crm"),
      "crm-flow.yaml":
        "apiVersion: ingestron.io/v1\nkind: Flow\nid: crm\nsource: crm\ningest: { with: { runtime_kind: azure } }\ntables:\n  accounts: { object: crm.dbo.Accounts, contract: invoices }\n",
    });
    expect(text).toContain(
      'ADF integration runtime shared-ir is described as {"type":"Managed","typeProperties":{"computeProperties":{"location":"AutoResolve"}}} and as {"type":"SelfHosted"}; give each runtime one runtime_kind and runtime',
    );
  });

  it("tells the platform request what each deployment does to each runtime", () => {
    const { result } = generate(withRuntime("ir-azure", "azure", "{ location: UK South }"));
    const lines = adf.request!(result.model!).flatMap((section) => section.lines);
    expect(lines).toContain(
      "Integration runtime `ir-azure` (Azure): the deployment sets its region, data flow compute and managed virtual network as runtime describes them, and resets its other settings, such as copy and pipeline compute, to their defaults. In a managed virtual network, the sources need managed private endpoints, which the factory does not hold.",
    );
    expect(lines.some((text) => text.includes("`az deployment group what-if`"))).toBe(true);
  });
});
