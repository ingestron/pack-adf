// Microsoft's own export, @microsoft/azure-data-factory-utilities, run on folded
// files: the package downloads its build tool, main.js, from Data Factory's site, at
// a URL with no version, and Microsoft serves different builds. The tests run against
// the build served, as the package's users do, and warn when it is not a known one;
// they are skipped, with the reason, when no build can be had, and with
// INGESTRON_REQUIRE_ADF_EXPORT=1, as CI sets it, they fail instead.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Where the package downloads its build tool from (its BundleManager.defaultBundleUrl). */
const bundleUrl = "https://adf.azure.com/assets/cmd-api/main.js";

/** A factory ID for the export; any well-formed one, since nothing is deployed. */
const factoryId =
  "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-data/providers/Microsoft.DataFactory/factories/adf-test";

/** A build of the tool seen served from the URL, which carries no version. */
interface Build {
  sha256: string;
  firstSeen: string;
  where: string;
}

/** The builds a maintainer has checked the tests against (test/adf-tool-builds.json). */
export const knownBuilds = JSON.parse(
  readFileSync(new URL("./adf-tool-builds.json", import.meta.url), "utf8"),
) as Build[];

/** The tool to run, its hash and whether it is a known build; or why there is none. */
export interface Tool {
  bundle?: string;
  hash?: string;
  reason?: string;
}

const hashOf = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const cacheRoot = join(tmpdir(), "ingestron-adf-utilities");

/**
 * The build tool to run: `ADF_UTILITIES_BUNDLE` when set, else the build the URL
 * serves now, cached under its hash. When the download fails, a cached build whose
 * file matches its key, unless `required`. Prints the hash in use, and warns when it
 * is not a known build, so that a maintainer checks it and adds it to the list.
 */
export async function exportTool(required: boolean): Promise<Tool> {
  const tool = await findTool(required);
  if (tool.hash) announce(tool.hash, tool.bundle!);
  return tool;
}

async function findTool(required: boolean): Promise<Tool> {
  const given = process.env.ADF_UTILITIES_BUNDLE;
  if (given) {
    if (!existsSync(given)) return { reason: `${given} does not exist` };
    return { bundle: given, hash: hashOf(readFileSync(given)) };
  }
  try {
    const response = await fetch(bundleUrl, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) return fallback(`${bundleUrl} answered ${response.status}`, required);
    return cache(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    return fallback(`${bundleUrl} could not be downloaded (${(error as Error).message})`, required);
  }
}

/** Keeps a downloaded build under its hash, unless a matching copy is there already. */
function cache(bytes: Buffer): Tool {
  const hash = hashOf(bytes);
  const bundle = join(cacheRoot, hash, "main.js");
  if (!existsSync(bundle) || hashOf(readFileSync(bundle)) !== hash) {
    mkdirSync(dirname(bundle), { recursive: true });
    writeFileSync(bundle, bytes);
  }
  return { bundle, hash };
}

/** Offline: the newest cached build whose file matches its key; none when required. */
function fallback(reason: string, required: boolean): Tool {
  if (required || !existsSync(cacheRoot)) return { reason };
  const cached = readdirSync(cacheRoot)
    .map((hash) => ({ hash, bundle: join(cacheRoot, hash, "main.js") }))
    .filter(({ hash, bundle }) => existsSync(bundle) && hashOf(readFileSync(bundle)) === hash)
    .sort((a, b) => statSync(b.bundle).mtimeMs - statSync(a.bundle).mtimeMs);
  if (cached.length === 0) return { reason };
  say(`${reason}; using the cached build ${cached[0]!.hash}.`);
  return cached[0]!;
}

/** The hash in use, and a warning for a build not in the list. */
function announce(hash: string, bundle: string): void {
  const known = knownBuilds.find((build) => build.sha256 === hash);
  if (known) {
    say(`Microsoft's ADF build tool: SHA-256 ${hash}, first seen ${known.firstSeen} (${bundle}).`);
    return;
  }
  const message = `Microsoft's ADF build tool has SHA-256 ${hash}, which is not in test/adf-tool-builds.json. The tests run against it; check the results and add the build to the list.`;
  say(
    process.env.GITHUB_ACTIONS
      ? `::warning title=New ADF build tool::${message}`
      : `Warning: ${message}`,
  );
}

/**
 * Writes a line straight to the process's output, past the test runner's capture of
 * the console, so that it shows (and GitHub Actions reads an annotation) when the
 * tests pass.
 */
function say(line: string): void {
  process.stdout.write(`${line}\n`);
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
  try {
    execFileSync(
      process.execPath,
      // The output folder is relative to the working folder.
      [utilities(), "--path", bundle, "export", factory, factoryId, "arm"],
      {
        cwd: output,
        stdio: "pipe",
      },
    );
  } catch (error) {
    throw new Error(`Microsoft's export refused ${factory}:\n${refusals(error)}`);
  }
  return JSON.parse(
    readFileSync(join(output, "arm", "ARMTemplateForFactory.json"), "utf8"),
  ) as Template;
}

/**
 * The lines of a failed export's output that say what it refused: its validator logs
 * each problem as "Resource '<name>' has the following validation error: …", among
 * many lines of progress; without them, the output's last lines.
 */
function refusals(error: unknown): string {
  const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
  const lines = `${stdout ?? ""}\n${stderr ?? ""}`.split("\n");
  const errors = lines.filter((line) => /validation error/.test(line));
  return (errors.length > 0 ? errors : lines.slice(-20)).join("\n");
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
export function exportedSecrets(template: Template): string[] {
  return Object.entries(template.parameters as Record<string, { type: string; metadata?: unknown }>)
    .filter(
      ([, parameter]) =>
        parameter.type === "secureString" &&
        /^Secure string for '[^']+' of '[^']+'$/.test(String(parameter.metadata)),
    )
    .map(([name]) => name);
}
