// The integration runtimes the linked services use, as resources of the factory.
// Microsoft's CI/CD expects each runtime in the factory's Git folder, with the same
// name, type and subtype in every stage: the npm export drops a `connectVia` to a
// runtime it cannot find in the folder, and the post-deployment script deletes every
// runtime that is not in the template (spec/references.md). An ARM deployment
// applies the whole resource, so what the definitions say about a runtime is written.
import type { ResolvedModel } from "@ingestron/definitions";
import { addResource } from "./resource-files.js";

/** ADF's own Azure runtime, which every factory has: never written. */
export const defaultRuntime = "AutoResolveIntegrationRuntime";

/** The managed virtual network a runtime joins, which ADF names `default`. */
export const managedNetwork = "default";

/** The integration runtime name ADF accepts. */
export const runtimeName = {
  type: "string",
  minLength: 3,
  maxLength: 63,
  pattern: "^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$",
  description:
    "Name of the integration runtime that reaches the source: 3 to 63 letters, digits and single hyphens. The factory's folder holds it, described by runtime_kind and runtime.",
  examples: ["shir-erp"],
};

/** How the factory describes its integration runtime, beyond its name and kind. */
export const runtimeSchema = {
  type: "object",
  additionalProperties: false,
  description:
    "How the factory describes the integration runtime: a deployment sets it as written. Leave it out for a self-hosted runtime of the factory's own, or an Azure runtime that resolves its region.",
  properties: {
    shared: {
      type: "string",
      pattern:
        "^/subscriptions/[^/]+/[Rr]esource[Gg]roups/[^/]+/providers/Microsoft\\.DataFactory/factories/[^/]+/[Ii]ntegration[Rr]untimes/[^/]+$",
      description:
        "Self-hosted: the resource ID of the shared runtime this one links to, in another factory; each environment may name its own.",
      examples: [
        "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-shared/providers/Microsoft.DataFactory/factories/adf-shared/integrationruntimes/shir-erp",
      ],
    },
    location: {
      type: "string",
      minLength: 1,
      description:
        "Azure: the runtime's region, by the display name Data Factory shows, such as UK South. Default: AutoResolve.",
    },
    managed_virtual_network: {
      type: "boolean",
      description: "Azure: the runtime is in the factory's managed virtual network.",
    },
    data_flow: {
      type: "object",
      additionalProperties: false,
      description: "Azure: the data flow compute. Default: General, 8 cores, no time to live.",
      properties: {
        compute_type: {
          enum: ["General", "MemoryOptimized", "ComputeOptimized"],
          enumDescriptions: [
            "General Purpose compute. The default.",
            "Memory Optimized compute, with more memory for each core. Microsoft suggests it, with more cores, when a data flow runs out of memory.",
            "Compute Optimized compute. ADF accepts it, but Microsoft's guides do not describe it; General or MemoryOptimized are the documented types.",
          ],
          description: "Azure: the type of Spark cluster that runs data flows.",
        },
        core_count: {
          enum: [8, 16, 32, 48, 80, 144, 272],
          description:
            "Azure: the total number of cores of the data flow cluster, driver and worker cores together. One of 8, 16, 32, 48, 80, 144 or 272. Default 8 (4 driver, 4 worker).",
        },
        time_to_live: {
          type: "integer",
          minimum: 0,
          description:
            "Azure: minutes the cluster stays warm after a data flow finishes, so the next one starts sooner.",
        },
      },
    },
  },
};

type Data = Record<string, unknown>;

/** A runtime's settings that belong to its kind; the others are a method check problem. */
export function runtimeProblems(settings: Data): string[] {
  const runtime = (settings.runtime ?? {}) as Data;
  const azure = ["location", "managed_virtual_network", "data_flow"].filter(
    (key) => key in runtime,
  );
  if (settings.runtime_kind === "azure" && "shared" in runtime)
    return ["runtime.shared links a self-hosted runtime; it needs runtime_kind: self-hosted"];
  if (settings.runtime_kind !== "azure" && azure.length > 0)
    return [
      azure.length === 1
        ? `runtime.${azure[0]} describes an Azure runtime; it needs runtime_kind: azure`
        : `runtime.${azure.join(", runtime.")} describe an Azure runtime; they need runtime_kind: azure`,
    ];
  if (shortRegion(runtime.location))
    return [
      `runtime.location "${String(runtime.location)}" is a region's short name; use its display name, with capitals and spaces, such as UK South, as Data Factory writes it: Microsoft's export rewrites a short name only where every environment has the same region`,
    ];
  if (settings.integration_runtime === defaultRuntime && Object.keys(runtime).length > 0)
    return [
      `${defaultRuntime} is ADF's own runtime, which the factory does not describe; remove runtime`,
    ];
  return [];
}

/** A region written as its short name, such as `uksouth`, rather than its display name. */
function shortRegion(location: unknown): boolean {
  return typeof location === "string" && /^[a-z][a-z0-9]*$/.test(location);
}

/** The runtime resource's properties for its settings. */
export function runtimeProperties(settings: Data): Data {
  const runtime = (settings.runtime ?? {}) as Data;
  if (settings.runtime_kind !== "azure") return selfHosted(runtime.shared as string | undefined);
  const dataFlowProperties = dataFlow(runtime.data_flow as Data | undefined);
  return {
    type: "Managed",
    typeProperties: {
      computeProperties: {
        location: runtime.location ?? "AutoResolve",
        ...(dataFlowProperties && { dataFlowProperties }),
      },
    },
    ...(runtime.managed_virtual_network === true && {
      managedVirtualNetwork: {
        type: "ManagedVirtualNetworkReference",
        referenceName: managedNetwork,
      },
    }),
  };
}

/** A self-hosted runtime: the factory's own, or linked to a shared one with RBAC. */
function selfHosted(shared: string | undefined): Data {
  if (!shared) return { type: "SelfHosted" };
  return {
    type: "SelfHosted",
    typeProperties: { linkedInfo: { authorizationType: "RBAC", resourceId: shared } },
  };
}

/** The data flow compute that the settings give, if any. */
function dataFlow(flow: Data | undefined): Data | undefined {
  if (!flow) return undefined;
  const names: Record<string, string> = {
    compute_type: "computeType",
    core_count: "coreCount",
    time_to_live: "timeToLive",
  };
  return Object.fromEntries(Object.entries(flow).map(([key, value]) => [names[key] ?? key, value]));
}

/**
 * Adds `integrationRuntime/<name>.json` for each runtime a linked service connects
 * through, other than ADF's default one, and the managed virtual network one joins.
 * A name the tables describe in two ways is an error.
 */
export function addRuntimes(files: Record<string, string>, model: ResolvedModel): void {
  const described = runtimeDescriptions(model);
  const names = new Set<string>();
  for (const [path, text] of Object.entries(files)) {
    if (!path.startsWith("linkedService/")) continue;
    const resource = JSON.parse(text) as { properties: { connectVia?: { referenceName: string } } };
    const name = resource.properties.connectVia?.referenceName;
    if (name && name !== defaultRuntime) names.add(name);
  }
  const runtimes = [...names].sort().map((name) => ({
    name,
    properties: described.get(name) ?? { type: "SelfHosted" },
  }));
  for (const runtime of runtimes) addResource(files, "integrationRuntime", runtime);
  if (runtimes.some((runtime) => "managedVirtualNetwork" in runtime.properties))
    addResource(files, "managedVirtualNetwork", { name: managedNetwork, properties: {} });
}

/** Each runtime's properties, from the tables that name it. */
export function runtimeDescriptions(model: ResolvedModel): Map<string, Data> {
  const described = new Map<string, Data>();
  for (const table of model.tables) {
    const settings = table.ingest?.settings;
    if (!settings || !/^adf-/.test(table.ingest!.method)) continue;
    const name = String(settings.integration_runtime ?? "");
    const properties = runtimeProperties(settings);
    const known = described.get(name);
    if (known && JSON.stringify(known) !== JSON.stringify(properties))
      throw new Error(
        `ADF integration runtime ${name} is described as ${JSON.stringify(known)} and as ${JSON.stringify(properties)}; give each runtime one runtime_kind and runtime`,
      );
    described.set(name, properties);
  }
  return described;
}
