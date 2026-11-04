// The folded factory through Microsoft's own export: every parameter each
// environment's file sets is in the exported template, and the template with an
// environment's parameters is what that environment's own factory exports to.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { adf, recipesFolder } from "../src/index.js";
import { suppliedTexts } from "../src/view.js";
import { base } from "./erp.js";
import {
  erpEnvironments,
  erpProject,
  fold,
  linkedRuntime,
  managedRuntime,
  parametersOf,
  resolveAll,
  type Models,
} from "./fold-helpers.js";
import {
  addedSecrets,
  deployed,
  exportTemplate,
  exportTool,
  writeFolder,
  type Template,
} from "./microsoft-export.js";

// Exported resources are untyped JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const tool = await exportTool();
const title = tool.bundle
  ? "Microsoft's export of the folded factory"
  : `Microsoft's export of the folded factory (skipped: ${tool.reason})`;

/**
 * Connectors whose resources Microsoft's validator refuses, so the export stops: the
 * MongoDB collection datasets ("Collection name is required") and Microsoft 365
 * ("Microsoft 365 source only supports copying to binary format dataset").
 */
const refused = ["mongodb", "mongodb-atlas", "azure-cosmos-db-mongodb", "microsoft-365"];

/** The connector catalogue in dev and prod, whose storage accounts differ. */
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
  for (const connector of refused) {
    delete files[`connections/${connector}.yaml`];
    delete files[`flows/${connector}.yaml`];
  }
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

const fixtures: Record<string, Models> = {
  "the connector catalogue": resolveAll(catalogue(), ["dev", "prod"]),
  "three environments": resolveAll(erpEnvironments(), ["dev", "test", "prod"]),
  "a linked self-hosted runtime": resolveAll(linkedRuntime(), ["dev", "prod"]),
  "an Azure runtime in a managed virtual network": resolveAll(managedRuntime(), ["dev", "prod"]),
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
function ownTemplate(bundle: string, models: Models, target: string): Template {
  const files = {
    ...adf.build(models[target]!),
    "arm-template-parameters-definition.json": "{}\n",
  };
  return exportTemplate(bundle, writeFolder(files));
}

// Each export starts Microsoft's 17 MB build tool, which takes a few seconds.
describe.skipIf(!tool.bundle).each(Object.entries(fixtures))(
  `${title}: %s`,
  { timeout: 120_000 },
  (_, models) => {
    const built = fold(models);
    const template = tool.bundle
      ? exportTemplate(tool.bundle, `${writeFolder(built.files)}/factory`)
      : {};
    const supplied = suppliedTexts(built.deployValues);

    it("declares every parameter the environments' files set or the pipeline supplies, and no other", () => {
      const added = tool.bundle ? addedSecrets(template) : [];
      const declared = Object.keys(template.parameters).filter(
        (name) => name !== "factoryName" && !added.includes(name),
      );
      for (const target of Object.keys(models)) {
        const names = [...Object.keys(parametersOf(built.files, target)), ...Object.keys(supplied)];
        expect(new Set(names)).toEqual(new Set(declared));
      }
    });

    it("adds a secure string of its own only for a secret a linked service leaves out", () => {
      for (const name of addedSecrets(template)) {
        const metadata = String(template.parameters[name].metadata);
        const [, property, resource] = /^Secure string for '([^']+)' of '([^']+)'$/.exec(metadata)!;
        const service = JSON.parse(built.files[`factory/linkedService/${resource}.json`]!);
        expect(service.properties.typeProperties[property!], name).toBeUndefined();
      }
    });

    it("keeps every runtime a linked service connects through, as the factory describes it", () => {
      const exported = new Map(
        (template.resources as { name: string; properties: Record<string, unknown> }[]).map(
          (resource) => [/'\/([^']+)'\)\]$/.exec(resource.name)![1]!, resource.properties],
        ),
      );
      for (const [path, text] of Object.entries(built.files)) {
        const resource = JSON.parse(text);
        const via = resource.properties?.connectVia?.referenceName;
        if (
          path.startsWith("factory/linkedService/") &&
          via &&
          via !== "AutoResolveIntegrationRuntime"
        )
          expect(exported.get(resource.name)!.connectVia, path).toEqual(
            resource.properties.connectVia,
          );
        if (!path.startsWith("factory/integrationRuntime/")) continue;
        const properties = exported.get(resource.name)!;
        expect(properties.type, path).toBe(resource.properties.type);
        expect(properties.managedVirtualNetwork, path).toEqual(
          resource.properties.managedVirtualNetwork,
        );
        const linked = (resource.properties.typeProperties ?? {}).linkedInfo;
        if (linked)
          expect((properties.typeProperties as Json).linkedInfo.resourceId, path).toMatch(
            /^\[parameters\('|^\/subscriptions\//,
          );
      }
    });

    it("tells the environments apart, so a fold that mixed them up would fail", () => {
      const [first, last] = [Object.keys(models)[0]!, Object.keys(models).at(-1)!];
      const values = { ...supplied, ...parametersOf(built.files, first) };
      expect(deployed(template, values)).not.toEqual(
        deployed(ownTemplate(tool.bundle!, models, last), {}),
      );
    });

    it("deploys to each environment what its own factory would", () => {
      for (const target of Object.keys(models)) {
        const values = { ...supplied, ...parametersOf(built.files, target) };
        expect(deployed(template, values), target).toEqual(
          deployed(ownTemplate(tool.bundle!, models, target), {}),
        );
      }
    });
  },
);
