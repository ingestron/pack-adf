// Microsoft's own export, @microsoft/azure-data-factory-utilities, run on folded
// files: the package downloads its build tool, main.js, from Data Factory's site,
// so the tests that use it are skipped, with the reason, when it cannot be had.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Where the package downloads its build tool from (its BundleManager.defaultBundleUrl). */
const bundleUrl = "https://adf.azure.com/assets/cmd-api/main.js";

/** A factory ID for the export; any well-formed one, since nothing is deployed. */
const factoryId =
  "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-data/providers/Microsoft.DataFactory/factories/adf-test";

/**
 * The build tool's path, downloaded once into the system's temporary folder, or why it
 * cannot be had. `ADF_UTILITIES_BUNDLE` names a copy to use offline.
 */
export async function exportTool(): Promise<{ bundle?: string; reason?: string }> {
  const given = process.env.ADF_UTILITIES_BUNDLE;
  if (given) return existsSync(given) ? { bundle: given } : { reason: `${given} does not exist` };
  const bundle = join(tmpdir(), "ingestron-adf-utilities", "main.js");
  if (existsSync(bundle)) return { bundle };
  try {
    const response = await fetch(bundleUrl, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) return { reason: `${bundleUrl} answered ${response.status}` };
    mkdirSync(dirname(bundle), { recursive: true });
    writeFileSync(bundle, Buffer.from(await response.arrayBuffer()));
    return { bundle };
  } catch (error) {
    return { reason: `${bundleUrl} could not be downloaded (${(error as Error).message})` };
  }
}

/** The package's command-line entry point. */
function utilities(): string {
  const require = createRequire(import.meta.url);
  const manifest = require.resolve("@microsoft/azure-data-factory-utilities/package.json");
  return join(dirname(manifest), "lib", "index.js");
}

/** Writes files under a new temporary folder and gives its path. */
export function writeFolder(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "ingestron-adf-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

// The exported template is untyped JSON; the tests read its parameters and resources.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Template = Record<string, any>;

/** `npm run start export <folder> <factoryId> <output>`, as the package's README says: the ARM template. */
export function exportTemplate(bundle: string, factory: string): Template {
  const output = mkdtempSync(join(tmpdir(), "ingestron-arm-"));
  execFileSync(
    process.execPath,
    // The output folder is relative to the working folder.
    [utilities(), "--path", bundle, "export", factory, factoryId, "arm"],
    {
      cwd: output,
      stdio: "pipe",
    },
  );
  return JSON.parse(
    readFileSync(join(output, "arm", "ARMTemplateForFactory.json"), "utf8"),
  ) as Template;
}

/**
 * The template's resources with each `[parameters('<name>')]` replaced by its value: what
 * ARM deploys with those values. Names (`[concat(parameters('factoryName'), …)]`) stay.
 */
export function deployed(template: Template, values: Record<string, unknown>): unknown[] {
  const replace = (node: unknown): unknown => {
    if (typeof node === "string") {
      const match = /^\[parameters\('([^']+)'\)\]$/.exec(node);
      return match && match[1] !== "factoryName" && match[1]! in values ? values[match[1]!] : node;
    }
    if (Array.isArray(node)) return node.map(replace);
    if (node && typeof node === "object")
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, replace(value)]));
    return node;
  };
  return (template.resources as unknown[]).map(replace);
}

/**
 * The secure strings the export adds for a linked service's optional secrets that the
 * factory leaves out, such as Square's refreshToken: each is a `secureString` parameter
 * with no default, described "Secure string for '<property>' of '<resource>'".
 */
export function addedSecrets(template: Template): string[] {
  return Object.entries(template.parameters as Record<string, { type: string; metadata?: unknown }>)
    .filter(
      ([, parameter]) =>
        parameter.type === "secureString" &&
        /^Secure string for '[^']+' of '[^']+'$/.test(String(parameter.metadata)),
    )
    .map(([name]) => name);
}
