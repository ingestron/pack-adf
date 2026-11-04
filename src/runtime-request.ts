// What the platform request says about each integration runtime the factory holds:
// a deployment writes each one as the definitions describe it, and resets the rest.
import type { ResolvedModel } from "@ingestron/definitions";
import { defaultRuntime, runtimeDescriptions } from "./runtimes.js";

type Data = Record<string, unknown>;

/** One line per runtime, and the check to run before the first deployment. */
export function runtimeLines(model: ResolvedModel): string[] {
  const described = runtimeDescriptions(model);
  const lines = [...described].map(([name, properties]) => line(name, properties));
  if ([...described.keys()].some((name) => name !== defaultRuntime))
    lines.push(
      "Before the first deployment to a factory that already has these integration runtimes, run `az deployment group what-if` with the template and that environment's parameter file, and check that it changes no runtime in a way you did not describe.",
    );
  return lines;
}

function line(name: string, properties: Data): string {
  if (name === defaultRuntime)
    return `Integration runtime \`${name}\`: ADF's own Azure runtime, with network access to the sources that use it.`;
  const linked = (properties.typeProperties as Data | undefined)?.linkedInfo as Data | undefined;
  if (linked)
    return `Integration runtime \`${name}\` (self-hosted, linked): the deployment links it to \`${String(linked.resourceId)}\`; the factory's managed identity needs access to that shared runtime, granted in the factory that holds it.`;
  if (properties.type === "SelfHosted")
    return `Integration runtime \`${name}\` (self-hosted): the deployment writes it by name and type, as Data Factory Studio does; where it creates it, register a node, with network access and any required source drivers, before the copies run.`;
  return `Integration runtime \`${name}\` (Azure): the deployment sets its region, data flow compute and managed virtual network as runtime describes them, and resets its other settings, such as copy and pipeline compute, to their defaults. In a managed virtual network, the sources need managed private endpoints, which the factory does not hold.`;
}
