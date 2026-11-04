// The projects the export tests run through Microsoft's export, each resolved for
// its environments, and what one environment's own factory exports to.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { adf, recipesFolder } from "../src/index.js";
import { base } from "./erp.js";
import {
  erpEnvironments,
  erpProject,
  identityProject,
  linkedRuntime,
  managedRuntime,
  regionalRuntime,
  squareProject,
  resolveAll,
  type Models,
} from "./fold-helpers.js";
import { exportTemplate, writeFolder, type Template } from "./microsoft-export.js";

/** The whole connector catalogue in dev and prod, whose storage accounts differ. */
function catalogue(): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (folder: string) => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
      else files[relative(recipesFolder, path)] = readFileSync(path, "utf8");
    }
  };
  walk(recipesFolder);
  return {
    ...files,
    "standard.yaml": files["standard.yaml"]!.replace("databricks@2", "store@1"),
    "platform.yaml": files["platform.yaml"]!.replaceAll("syntheticlake", "${values.lake}"),
    "project.yaml": files["project.yaml"]!.replace(
      "  dev: {}\n  prod: {}",
      "  dev: { values: { lake: syntheticlakedev } }\n  prod: { values: { lake: syntheticlake } }",
    ),
  };
}

/** The ERP project with each resource name at the longest the pack allows. */
function longestNames(): Record<string, string> {
  const name = (letter: string, length: number) => letter + "x".repeat(length - 1);
  const names = {
    source_linked_service: name("l", 140),
    source_dataset: name("d", 140),
    pipeline: name("p", 140),
    trigger: name("t", 140),
    copy_activity: name("c", 55),
  };
  return {
    ...base,
    "standard.yaml": base["standard.yaml"]!.replace(
      "      start: 2026",
      `      resource_names: ${JSON.stringify(names)}\n      start: 2026`,
    ),
  };
}

/** Each project the export tests fold, by what it shows. */
export const exportFixtures: Record<string, Models> = {
  "the connector catalogue": resolveAll(catalogue(), ["dev", "prod"]),
  "three environments": resolveAll(erpEnvironments(), ["dev", "test", "prod"]),
  "a linked self-hosted runtime": resolveAll(linkedRuntime(), ["dev", "prod"]),
  "an Azure runtime in a managed virtual network": resolveAll(managedRuntime(), ["dev", "prod"]),
  "an Azure runtime whose region and data flow compute differ": resolveAll(regionalRuntime(), [
    "dev",
    "prod",
  ]),
  "a user-assigned managed identity per environment": resolveAll(identityProject(), [
    "dev",
    "prod",
  ]),
  "the longest names Microsoft's export accepts": resolveAll(longestNames(), ["dev", "prod"]),
  "Square's refresh token from Key Vault": resolveAll(
    squareProject(", refresh_token: '${secret:refresh-token}'"),
    ["dev", "prod"],
  ),
  "a deploy-time vault": resolveAll(
    {
      ...base,
      "standard.yaml": base["standard.yaml"]!.replace(
        "https://kv-erp.vault.azure.net",
        "${values.vault}",
      ),
      "project.yaml": erpProject([
        "  dev: { values: { vault: 'https://kv-erp-dev.vault.azure.net' } }",
        "  prod: { values: { vault: '${envvar:PROD_VAULT}' } }",
      ]),
    },
    ["dev", "prod"],
  ),
};

/** What one environment's own factory exports to, with no parameters at all. */
export function ownTemplate(bundle: string, models: Models, target: string): Template {
  const files = {
    ...adf.build(models[target]!),
    "arm-template-parameters-definition.json": "{}\n",
  };
  return exportTemplate(bundle, writeFolder(files));
}
