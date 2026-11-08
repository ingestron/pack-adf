// The folded factory through Microsoft's own export: every parameter each
// environment's file sets is in the exported template, and the template with an
// environment's parameters is what that environment's own factory exports to.
import { describe, expect, it } from "vitest";
import { suppliedTexts } from "../src/fold/view.js";
import { exportFixtures, ownTemplate } from "./export-fixtures.js";
import { fold, parametersOf } from "./fold-helpers.js";
import {
  exportedSecrets,
  deployed,
  exportTemplate,
  exportTool,
  writeFolder,
} from "./microsoft-export.js";

// Exported resources are untyped JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const required = process.env.INGESTRON_REQUIRE_ADF_EXPORT === "1";
const tool = await exportTool(required);
const title = tool.bundle
  ? "Microsoft's export of the folded factory"
  : `Microsoft's export of the folded factory (skipped: ${tool.reason})`;

// Each export starts Microsoft's 17 MB build tool, which takes a few seconds.
describe.skipIf(!tool.bundle).each(Object.entries(exportFixtures))(
  `${title}: %s`,
  { timeout: 120_000 },
  (_, models) => {
    const built = fold(models);
    const template = tool.bundle
      ? exportTemplate(tool.bundle, `${writeFolder(built.files)}/factory`)
      : {};
    const supplied = suppliedTexts(built.deployValues);

    it("declares exactly the parameters each environment's file sets and the pipeline supplies", () => {
      const declared = Object.keys(template.parameters).filter((name) => name !== "factoryName");
      for (const target of Object.keys(models)) {
        const names = [...Object.keys(parametersOf(built.files, target)), ...Object.keys(supplied)];
        expect(new Set(names)).toEqual(new Set(declared));
      }
    });

    it("lists each secure string the export adds, for a secret a linked service leaves out", () => {
      for (const name of exportedSecrets(template)) {
        expect(built.deployValues, name).toContainEqual({ name, suppliedAs: [name] });
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

    it("keeps every credential a linked service references, with its identity", () => {
      const exported = new Map(
        (template.resources as { name: string; type: string; properties: Json }[]).map(
          (resource) => [/'\/([^']+)'\)\]$/.exec(resource.name)![1]!, resource],
        ),
      );
      for (const [path, text] of Object.entries(built.files)) {
        const resource = JSON.parse(text);
        const credential = resource.properties?.typeProperties?.credential;
        if (path.startsWith("factory/linkedService/") && credential?.type === "CredentialReference")
          expect(exported.get(resource.name)!.properties.typeProperties.credential, path).toEqual(
            credential,
          );
        if (!path.startsWith("factory/credential/")) continue;
        const exportedCredential = exported.get(resource.name)!;
        expect(exportedCredential.type, path).toBe("Microsoft.DataFactory/factories/credentials");
        expect(exportedCredential.properties.typeProperties.resourceId, path).toMatch(
          /^\[parameters\('|^\/subscriptions\//,
        );
      }
    });

    it("tells the environments apart, so a fold that mixed them up would fail", () => {
      const [first, last] = [Object.keys(models)[0]!, Object.keys(models).at(-1)!];
      const values = { ...supplied, ...parametersOf(built.files, first) };
      expect(deployed(template, values)).not.toEqual(
        deployed(ownTemplate(tool.bundle!, models, last), supplied),
      );
    });

    it("deploys to each environment what its own factory would", () => {
      for (const target of Object.keys(models)) {
        const values = { ...supplied, ...parametersOf(built.files, target) };
        expect(deployed(template, values), target).toEqual(
          deployed(ownTemplate(tool.bundle!, models, target), supplied),
        );
      }
    });
  },
);

describe.runIf(required && !tool.bundle)(
  "Microsoft's export, required by INGESTRON_REQUIRE_ADF_EXPORT=1",
  () => {
    it("can be downloaded and run", () => {
      expect.fail(tool.reason);
    });
  },
);
