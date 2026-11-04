// Projects resolved for every environment, as the CLI resolves them for a pack that
// builds environments together, and the fold property checked on them.
import { memoryFiles } from "@ingestron/config";
import {
  checkFold,
  resolveDefinitions,
  type FoldView,
  type ResolvedModel,
} from "@ingestron/definitions";
import { adf } from "../src/index.js";
import { factoryView, sameResource, suppliedTexts } from "../src/view.js";
import { base, withAfterCopy } from "./erp.js";
import { store } from "./store-pack.js";

/** Each target's model, by name. */
export type Models = Record<string, ResolvedModel>;

const job = (subscription: number) =>
  `/subscriptions/00000000-0000-0000-0000-00000000000${subscription}/resourceGroups/rg-data/providers/Microsoft.App/jobs/sales-job`;

/**
 * The ERP project in three environments. The storage account is the same in test and
 * prod but differs in dev; the vault and the after-copy job differ in each.
 */
export function erpEnvironments(changes: Record<string, string> = {}): Record<string, string> {
  const values = (lake: string, vault: string, subscription: number) =>
    `{ lake: ${lake}, vault: 'https://${vault}.vault.azure.net', job: '${job(subscription)}' }`;
  const project = [
    "id: erp",
    `values: ${values("erplakedev", "kv-erp-dev", 1)}`,
    "environments:",
    "  dev: {}",
    `  test: { values: ${values("erplake", "kv-erp-test", 2)} }`,
    `  prod: { values: ${values("erplake", "kv-erp-prod", 3)} }`,
    "imports: ['*.yaml']",
    "",
  ].join("\n");
  const standard = withAfterCopy("{ job: '${values.job}' }")
    .replace("erplake", "${values.lake}")
    .replace("https://kv-erp.vault.azure.net", "${values.vault}")
    .replace(
      "      start: 2026",
      "      pattern: foreach\n      audit_columns: { _environment: '${environment.name}', _run: run.id }\n      start: 2026",
    );
  return { ...base, "project.yaml": project, "standard.yaml": standard, ...changes };
}

/** A project.yaml for the ERP project with the environments given, as YAML lines. */
export function erpProject(environments: string[]): string {
  return ["id: erp", "environments:", ...environments, "imports: ['*.yaml']", ""].join("\n");
}

/** Each environment's model, resolved with deploy-time values; fails on any error. */
export function resolveAll(files: Record<string, string>, environments: string[]): Models {
  return Object.fromEntries(
    environments.map((environment) => {
      const result = resolveDefinitions(memoryFiles(files), {
        packs: [store, adf],
        environment,
        deployTime: true,
        environmentsTogether: true,
      });
      const errors = result.diagnostics.filter((item) => item.severity === "error");
      if (errors.length > 0 || !result.model)
        throw new Error(`${environment}: ${errors.map((item) => item.message).join("; ")}`);
      return [environment, result.model];
    }),
  );
}

/** The folded factory for the models. */
export function fold(models: Models) {
  return adf.buildEnvironments!(models);
}

/** How ARM deploys the folded files for one target, given what the pipeline supplies. */
export function armFold(models: Models): FoldView {
  const supplied = suppliedTexts(fold(models).deployValues);
  return { view: (files, target) => factoryView(files, target, supplied), same: sameResource };
}

/** The fold property's failures for the models of the first one, two and more targets. */
export function foldFailures(models: Models): string[] {
  return checkFold(adf, models, armFold(models));
}

// Parsed JSON is untyped; the assertions check its shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

/** A file as JSON data. */
export function jsonOf(files: Record<string, string>, path: string): Json {
  return JSON.parse(files[path] ?? "null") as Json;
}

/** The parameter names and values a target's parameter file sets. */
export function parametersOf(files: Record<string, string>, target: string) {
  const parameters = jsonOf(files, `parameters/${target}.json`).parameters as Record<
    string,
    { value: unknown }
  >;
  return Object.fromEntries(Object.entries(parameters).map(([name, { value }]) => [name, value]));
}

/** A shared runtime's resource ID in a subscription. */
export const sharedRuntime = (subscription: number) =>
  `/subscriptions/00000000-0000-0000-0000-00000000000${subscription}/resourceGroups/rg-shared/providers/Microsoft.DataFactory/factories/adf-shared/integrationruntimes/shir-erp`;

/** The ERP project in dev and prod, whose runtime links to each environment's shared one. */
export function linkedRuntime(): Record<string, string> {
  return {
    ...base,
    "standard.yaml": base["standard.yaml"]!.replace(
      "      integration_runtime: shir-erp\n",
      "      integration_runtime: shir-erp\n      runtime: { shared: '${values.shared}' }\n",
    ),
    "project.yaml": erpProject([
      `  dev: { values: { shared: '${sharedRuntime(1)}' } }`,
      `  prod: { values: { shared: '${sharedRuntime(2)}' } }`,
    ]),
  };
}

/** The ERP project in dev and prod, through an Azure runtime in a managed virtual network. */
export function managedRuntime(): Record<string, string> {
  return {
    ...base,
    "standard.yaml": base["standard.yaml"]!.replace("erplake", "${values.lake}").replace(
      "      integration_runtime: shir-erp\n",
      "      integration_runtime: ir-erp\n      runtime_kind: azure\n      runtime: { location: UK South, managed_virtual_network: true, data_flow: { compute_type: General, core_count: 16, time_to_live: 10 } }\n",
    ),
    "project.yaml": erpProject([
      "  dev: { values: { lake: erplakedev } }",
      "  prod: { values: { lake: erplake } }",
    ]),
  };
}

/** The ERP project reading Square in dev and prod, with the connection settings given. */
export function squareProject(settings: string): Record<string, string> {
  return {
    ...base,
    "standard.yaml": base["standard.yaml"]!.replace("adf-copy:", "adf-table:"),
    "erp.yaml": `apiVersion: ingestron.io/v1\nkind: Connection\nid: erp\nconnector: square\nconnectivity: private\nsettings: { host: source.example.test, client_id: synthetic-client, client_secret: '\${secret:client-secret}', access_token: '\${secret:access-token}'${settings} }\n`,
    "flow.yaml": base["flow.yaml"]!.replace("erp.dbo.Invoices", "orders"),
    "project.yaml": erpProject(["  dev: {}", "  prod: {}"]),
  };
}
