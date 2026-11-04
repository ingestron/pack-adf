// The integration runtimes the linked services use, as resources of the factory.
// Microsoft's CI/CD expects each runtime in the factory's Git folder, with the same
// name and type in every stage: the npm export drops a `connectVia` to a runtime it
// cannot find, and the post-deployment script deletes every runtime that is not in
// the template (spec/references.md).
import type { ResolvedModel } from "@ingestron/definitions";
import { addResource } from "./resource-files.js";

/** ADF's own Azure runtime, which every factory has: never written. */
const defaultRuntime = "AutoResolveIntegrationRuntime";

/** What each kind of runtime is in ADF's JSON: only its type, as Studio writes a new one. */
const kinds: Record<string, Record<string, unknown>> = {
  "self-hosted": { type: "SelfHosted" },
  azure: { type: "Managed", typeProperties: { computeProperties: { location: "AutoResolve" } } },
};

/**
 * Adds `integrationRuntime/<name>.json` for each runtime a linked service connects
 * through, other than ADF's default one. A name used with two kinds is an error.
 */
export function addRuntimes(files: Record<string, string>, model: ResolvedModel): void {
  const kindOf = runtimeKinds(model);
  const names = new Set<string>();
  for (const [path, text] of Object.entries(files)) {
    if (!path.startsWith("linkedService/")) continue;
    const resource = JSON.parse(text) as { properties: { connectVia?: { referenceName: string } } };
    const name = resource.properties.connectVia?.referenceName;
    if (name && name !== defaultRuntime) names.add(name);
  }
  for (const name of [...names].sort())
    addResource(files, "integrationRuntime", {
      name,
      properties: kinds[kindOf.get(name) ?? "self-hosted"],
    });
}

/** Each runtime's kind, from the tables that name it. */
function runtimeKinds(model: ResolvedModel): Map<string, string> {
  const kinds = new Map<string, string>();
  for (const table of model.tables) {
    const settings = table.ingest?.settings;
    if (!settings || !/^adf-/.test(table.ingest!.method)) continue;
    const name = String(settings.integration_runtime ?? "");
    const kind = String(settings.runtime_kind ?? "self-hosted");
    const known = kinds.get(name);
    if (known && known !== kind)
      throw new Error(
        `ADF integration runtime ${name} is used as ${known} and as ${kind}; give each runtime one runtime_kind`,
      );
    kinds.set(name, kind);
  }
  return kinds;
}
