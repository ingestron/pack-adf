// Infrastructure requests name prerequisites without attempting to provision them.
import type { RequestSection, ResolvedModel } from "@ingestron/definitions";
import { connectors } from "./connectors.js";
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
      lines: [...infrastructure, ...sources],
    },
  ];
}
