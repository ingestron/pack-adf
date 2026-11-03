# References

## Managed-identity file ingestion

Checked 2026-10-30 against official Microsoft documentation:

- [Azure Blob Storage system-assigned managed identity](https://learn.microsoft.com/en-us/azure/data-factory/connector-azure-blob-storage#system-assigned-managed-identity-authentication): serviceEndpoint, storage permissions and binary copying.
- [ADLS Gen2 system-assigned managed identity](https://learn.microsoft.com/en-us/azure/data-factory/connector-azure-data-lake-storage#system-assigned-managed-identity-authentication): AzureBlobFS URL and destination permissions.

Neither managed-identity mode requires a Key Vault secret. Omitting an unused vault
does not change authentication fields or the requirement for storage data access.

The Blob connector also documents `connectVia` as optional: omitting it uses the
default Azure integration runtime. Accessed 2026-10-30.

## Landing layouts

Accessed 2026-11-01:

- [Parquet format](https://learn.microsoft.com/en-us/azure/data-factory/format-parquet):
  `maxRowsPerFile` is an optional `ParquetWriteSettings` setting that splits
  output into several files; the pack never sets it, so each copy writes the
  one file its sink dataset names.
- [ADLS Gen2 connector](https://learn.microsoft.com/en-us/azure/data-factory/connector-azure-data-lake-storage):
  the sink's `folderPath` and `fileName`, which the pack sets per table.
- A copy writing a file name that already exists replaces it; copy cannot
  append to a file. Microsoft's documentation does not say so directly; this
  is from [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/608206/adf-copy-activity-inside-foreach-activity-overwrit),
  and the `snapshot` layout relies on it.
- Concurrent copies writing the same ADLS Gen2 file can fail with
  `AdlsGen2OperationFailedConcurrentWrite` ([Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/880077/azure-data-factory-copy-activity-adlsgen2operation)),
  one reason two tables must not land at the same file.

## Starting a job after the copies

Accessed 2026-11-01:

- Container Apps REST API, version 2026-07-01:
  [Jobs - Start](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/jobs/start)
  (200 with the execution's `name` and `id`, or 202 with `Location`),
  [Job Execution](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/job-execution/job-execution)
  (`properties.status`: `Running`, `Processing`, `Stopped`, `Degraded`,
  `Failed`, `Unknown`, `Succeeded`) and
  [Jobs - Stop Execution](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/jobs/stop-execution).
- [Jobs in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/jobs):
  the Container Apps Jobs Operator role, and the custom-role actions.
- [Pipelines and activities](https://learn.microsoft.com/en-us/azure/data-factory/concepts-pipelines-activities):
  an activity name has at most 55 characters, a pipeline name at most 140;
  dependency conditions `Succeeded`, `Failed`, `Skipped`, `Completed`.
- [Web activity](https://learn.microsoft.com/en-us/azure/data-factory/control-flow-web-activity):
  `authentication` of type `MSI` with a `resource`, and the asynchronous
  pattern for 202 responses.
- [Until activity](https://learn.microsoft.com/en-us/azure/data-factory/control-flow-until-activity):
  `timeout` as `[d.]hh:mm:ss`; an inner activity's failure does not stop the loop.

## Reruns of the ForEach pattern

Accessed 2026-11-03:

- [Expressions and functions](https://learn.microsoft.com/en-us/azure/data-factory/control-flow-expression-language-functions):
  documents `@item()`, `empty`, `if` and `formatDateTime`. It documents no
  safe-navigation form such as `item()?.file`, so the pack keeps `item().file`
  and `item().watermark`, and every item carries all its keys. The only
  mention of `?.` found is community guidance on Microsoft Q&A, which is not
  an official source. The documentation does not say whether `if` evaluates
  both branches, so a rerun must give `windowStart` and `windowEnd`.

## Design settings

Accessed 2026-11-03, against current Microsoft documentation. Each setting
below is what the pack writes for `pattern`, `parallel`, `activity`,
`audit_columns`, `folder` and `annotations`.

- **Copy activity policy** (`activity`): `retries`, `retry_interval` and
  `timeout` become `retry`, `retryIntervalInSeconds` and `timeout` in the
  activity's `policy`.
  - [Pipelines and activities, Activity policy](https://learn.microsoft.com/en-us/azure/data-factory/concepts-pipelines-activities#activity-policy):
    `timeout` is a timespan, `retry` an integer defaulting to 0, and
    `retryIntervalInSeconds` an integer defaulting to 30. The page also says
    the default time-out is 12 hours with a minimum of 10 minutes; the pack
    enforces the minimum, so `activity.timeout` is 10 minutes or more.
  - [Pipelines - Create Or Update, ActivityPolicy](https://learn.microsoft.com/en-us/rest/api/datafactory/pipelines/create-or-update):
    `retryIntervalInSeconds` has a minimum of 30 and a maximum of 86400,
    which the pack's limits follow; the REST page gives the default time-out
    as 7 days, against the 12 hours above. The pack sets a timeout only when
    the team does.
- **Additional columns** (`audit_columns`):
  - [Copy activity overview, Add additional columns during copy](https://learn.microsoft.com/en-us/azure/data-factory/copy-activity-overview#add-additional-columns-during-copy):
    `additionalColumns` in the copy source is an array of `name` and `value`;
    a value is `$$FILEPATH`, `$$COLUMN:<name>`, an expression or a static
    value. The feature needs the latest dataset model, and the new columns
    must be mapped to the sink when the mapping is explicit.
  - [SQL Server connector, Dataset properties](https://learn.microsoft.com/en-us/azure/data-factory/connector-sql-server#dataset-properties):
    `SqlServerTable` with an optional top-level `schema` and `typeProperties`
    holding `schema` and `table`. The empty `typeProperties: {}` the pack
    writes for the source dataset is not documented; ADF refused additional
    columns without it (`AdditionalColumnWithInvalidDataset`) in the live
    check of 2026-11-02.
- **ForEach** (`pattern: foreach`, `parallel`):
  - [ForEach activity](https://learn.microsoft.com/en-us/azure/data-factory/control-flow-for-each-activity):
    `isSequential` defaults to false; `batchCount` is the upper concurrency
    limit, an integer up to 50 with a default of 20 (the pack defaults to 4);
    `items` is an expression returning an array, at most 100,000 items;
    `@item()` is the current item. Concurrent iterations writing the same
    file can fail, which is why each table names its own file.
- **Pipeline and dataset folders** (`folder`):
  [Pipelines - Create Or Update, PipelineFolder](https://learn.microsoft.com/en-us/rest/api/datafactory/pipelines/create-or-update)
  and [Datasets - Create Or Update, DatasetFolder](https://learn.microsoft.com/en-us/rest/api/datafactory/datasets/create-or-update):
  `properties.folder.name` is the folder; without it the resource sits at the
  root. The pages do not say how a nested folder is written; the pack
  passes the team's `folder` text as it is.
- **Annotations** (`annotations`):
  [Pipelines and activities, Pipeline JSON](https://learn.microsoft.com/en-us/azure/data-factory/concepts-pipelines-activities#pipeline-json):
  `annotations` is an optional array of tags on the pipeline.
