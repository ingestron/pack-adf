// The pipeline of native table copies: a Copy activity per table, landing as Parquet.
import {
  activity,
  annotationsOf,
  describeCopy,
  describePipeline,
  policyOf,
} from "../design/index.js";
import { resourceName } from "../factory/index.js";
import type { ResolvedModel, ResolvedTable } from "@ingestron/definitions";
import { nativeSource, stagingOptions, tableTranslator } from "../resources/index.js";
import { landedFile } from "../design/index.js";
import { flowParameters, reference, type Shared } from "../resources/index.js";
import type { TableSource } from "../connection/index.js";

type Data = Record<string, unknown>;

/** The pipeline for one group of tables: `name` is the connection's, `pipeline` the pipeline's own. */
export function tablePipeline(
  model: ResolvedModel,
  tables: ResolvedTable[],
  source: TableSource,
  shared: Shared,
  names: { name: string; pipeline: string; dataset: (table: ResolvedTable) => string },
): Data {
  return {
    name: names.pipeline,
    properties: {
      description: describePipeline(tables, "one Copy activity per table"),
      // Native pipelines had no annotations; they get them when the tables name some.
      ...(tables[0]!.ingest!.settings.annotations !== undefined && {
        annotations: annotationsOf(model, tables),
      }),
      parameters: {
        windowStart: { type: "string" },
        windowEnd: { type: "string" },
        ...flowParameters(tables),
      },
      activities: tables.map((table) =>
        tableActivity(table, source, shared, names.dataset(table), names.name),
      ),
    },
  };
}

function tableActivity(
  table: ResolvedTable,
  source: TableSource,
  shared: Shared,
  dataset: string,
  name: string,
): Data {
  const options = (table.ingest!.settings.source_options ?? {}) as Data;
  return activity(
    resourceName(table, "copy_activity", `copy_${table.name}`),
    describeCopy(table, source.id === "microsoft-365" ? "JSON" : "Parquet"),
    "Copy",
    {
      inputs: [reference(dataset, "DatasetReference")],
      outputs: [tableOutput(table, source, shared, name)],
      typeProperties: {
        source: nativeSource(table, source),
        sink: tableSink(source),
        ...(source.staged
          ? stagingOptions(
              source,
              resourceName(table, "staging_linked_service", `ls_${name}_staging`),
              options.staging_path,
            )
          : {}),
        ...tableTranslator(table, source),
      },
    },
    policyOf(table),
  );
}

function tableOutput(
  table: ResolvedTable,
  source: TableSource,
  shared: Shared,
  name: string,
): Data {
  if (source.id !== "microsoft-365")
    return {
      ...reference(shared.landingDataset, "DatasetReference"),
      parameters: landedFile(table, "parquet"),
    };
  // Microsoft 365 lands in a folder, in files Microsoft names (layoutProblems).
  return {
    ...reference(
      resourceName(table, "json_landing_dataset", `ds_${name}_json`),
      "DatasetReference",
    ),
    parameters: { folder: landedFile(table, "json").folder },
  };
}

/**
 * Parquet; for Microsoft 365, a binary copy of the JSON files Microsoft writes, the only
 * sink Microsoft's export accepts for it (spec/references.md).
 */
function tableSink(source: TableSource): Data {
  if (source.id === "microsoft-365")
    return { type: "BinarySink", storeSettings: { type: "AzureBlobFSWriteSettings" } };
  return {
    type: "ParquetSink",
    storeSettings: {
      type: "AzureBlobFSWriteSettings",
      ...(source.staged && { copyBehavior: "MergeFiles" }),
    },
    formatSettings: { type: "ParquetWriteSettings" },
  };
}
