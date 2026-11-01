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
