// Infrastructure requests name prerequisites without attempting to provision them.
import type { RequestSection, ResolvedModel } from "@ingestron/definitions";
import { connectors } from "./connectors.js";
import { afterCopyOf, timeoutSeconds } from "./after-copy-settings.js";
/** Shared ADF infrastructure and source-specific access for the platform request. */
export function prerequisites(model: ResolvedModel): RequestSection[] {
  const tables = model.tables.filter((table) => table.ingest?.pack === "adf");
  const infrastructure = new Set<string>();
  const sources = new Set<string>();
  for (const table of tables) {
    const ingest = table.ingest!;
    infrastructure.add(
      `Integration runtime \`${String(ingest.settings.integration_runtime)}\` (${String(ingest.settings.runtime_kind)}), with network access and any required source drivers.`,
    );
    if (ingest.settings.key_vault)
      infrastructure.add(
        `Key Vault \`${String(ingest.settings.key_vault)}\`, with the named secrets and factory identity access.`,
      );
    infrastructure.add(
      `Landing \`${String(ingest.settings.landing)}\`, with write access for the factory identity; Microsoft 365 uses its configured application.`,
    );
    const connector = connectors.find((item) => item.id === ingest.connection.connector)!;
    sources.add(
      `Connection \`${ingest.connection.id}\`: source permissions and runtime prerequisites from [${connector.title}](${connector.docs}).`,
    );
    if ((ingest.settings.source_options as Record<string, unknown> | undefined)?.staging_sas)
      infrastructure.add(
        "Azure Blob staging storage with a SAS secret permitting source export, runtime reads and cleanup.",
      );
  }
  return [
    {
      title: "ADF prerequisites",
      intro:
        "Provision these before running the generated assets. Generation does not inspect Azure or validate source credentials.",
      lines: [...infrastructure, ...jobLines(model), ...sources],
    },
  ];
}

/** The job after the copies: the factory's role on it, and its limits within after_copy.timeout. */
function jobLines(model: ResolvedModel): string[] {
  const afterCopy = afterCopyOf(model);
  if (!afterCopy) return [];
  const name = afterCopy.job.split("/").at(-1)!;
  const total = timeoutSeconds(afterCopy.timeout) ?? 0;
  return [
    `The factory's managed identity needs the Container Apps Jobs Operator role on \`${name}\`, or a custom role with Microsoft.App/jobs/read, start/action, stop/execution/action and executions/read.`,
    `Set \`${name}\`'s replica timeout to ${Math.floor(total / 2)} seconds and retry limit to 1, so a retried run ends within after_copy.timeout (${afterCopy.timeout}).`,
    "When you turn after_copy on, set `start` to the next window: the new triggers run every window since `start`, each copying again and starting the job.",
  ];
}
