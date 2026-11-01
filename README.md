# @ingestron/pack-adf

The Azure Data Factory pack: copies data from sources the data platform
cannot reach into a landing folder, where a store pack loads it. Use it after
the pack that stores the landed files, such as Databricks:

```yaml
packs: [databricks@1, adf@1]
```

## Methods

| Method      | Copies                                                                                         | From                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `adf-copy`  | Tables as Parquet: only the contract's columns, the whole table or only the window's changes   | The SQL Server family: SQL Server, Azure SQL Database and Managed Instance, Synapse, RDS        |
| `adf-table` | Whole tables as Parquet (JSON for Microsoft 365); the store decides whether to append or merge | ADF's other native connectors: databases, SAP, SaaS applications, exports and protocols         |
| `adf-files` | Files as they are                                                                              | File shares, HTTP, FTP and SFTP, HDFS, and cloud file stores (Azure, Amazon S3, Google, Oracle) |

The pack's rules choose them for private sources (`connectivity: private`); a
flow can name one for any connectivity.

The output is ADF's own resource JSON, in the folders ADF keeps in Git
(`linkedService/`, `dataset/`, `pipeline/`, `trigger/`), so it can be added to a
factory's repository and published as usual: linked services with secrets as
Key Vault references, a pipeline per connection with a copy per table or file
set into `<landing>/<object>/`, and a tumbling window trigger, started in
production and stopped elsewhere. Self-hosted integration runtimes and Key
Vaults are shared infrastructure: they are referenced by name, never created.

## Landing layouts

`adf-copy` and `adf-table` lay out each table's files in one of three ways,
usually set in the standard; a flow or table can set its own, and the one set
closer to the table wins:

| Setting                                               | Files                                                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `layout: snapshot`                                    | One file per table, `<object>/<object>.parquet` (`.json` for Microsoft 365), replaced by each run           |
| `layout: increments`                                  | A new file per run under `<object>/`, named by the window's start and the run                               |
| `path: "{object}/{yyyy}/{MM}/{object}_{run}.parquet"` | Your own path: `{object}`, `{connection}`, the window start's `{yyyy}`, `{MM}`, `{dd}`, `{HH}`, and `{run}` |

A path must include `{object}`, so tables keep their own files, and must not
start with `/`, use `.` or `..` as a folder, or have a name starting with `@`,
which ADF reads as an expression. It adds a file
per run when it has `{run}`, or the date tokens down to the window's unit
(`{yyyy}`, `{MM}`, `{dd}` and `{HH}` for hourly windows; `{yyyy}` and `{MM}`
for monthly ones); otherwise each run replaces the file. Without a setting, a
flow that ends at the landed files gets `snapshot`, unless each run holds only
its window (`mode: incremental`, or Microsoft 365's date filter), which gets
`increments`; a flow a store reads gets `increments`.

ADF alone can be the whole project when the landed files are what you need, for
example for reports that read them directly:

```yaml
packs: [adf@1]
store: { default: none }
```

Each method records where it lands each table's files, so other packs can read
them. The pack refuses a layout that would lose data (loads that hold only
their window, written to a file the next run replaces, with no store step to
merge them) and two tables landing at the same files.

## Start a job after the copies

With the platform setting `after_copy`, set under each ADF method a project uses (`adf-copy`, `adf-files`, `adf-table`), ADF starts an Azure Container Apps job
after each schedule's copies, for example one that builds tables from the
landed files:

```yaml
# platform.yaml
settings:
  adf-copy:
    after_copy:
      job: /subscriptions/<id>/resourceGroups/rg-data/providers/Microsoft.App/jobs/sales-job
      timeout: "01:00:00" # the default
```

Each schedule then has one parent pipeline, `pl_<project>_every_<interval>_<unit>`,
and one trigger in place of the connection pipelines' triggers. The parent:

1. runs the schedule's connection pipelines in parallel;
2. starts the job once, signed in as the factory's managed identity, with no
   retry, and fails at once when the start call gives no run name;
3. reads the run's status every 30 seconds until it ends, and fails the
   pipeline when the run did not succeed or its status cannot be read after
   three tries;
4. stops the run and fails when it is still going at `timeout`, saying whether
   it stopped.

A failed copy is retried in place (`retries`); the schedule's trigger does not
retry, so a retry never copies the schedule again or starts the job twice.
When you turn `after_copy` on, set `start` to the next window: the new
triggers run every window since `start`, each copying again and starting the
job.

The factory's managed identity needs the Container Apps Jobs Operator role on
the job, or a custom role with `Microsoft.App/jobs/read`, `start/action`,
`stop/execution/action` and `executions/read`; `ingestron request` says so,
with the job's replica timeout and retry limit to set. Two schedules may
start the job at the same time.

Checked against live Azure: not yet. The parent reads the run's name from the
start call's response (`@activity('start_job').output.name`).

## Connector catalogue

`recipesFolder` is a tested project with one connection and one flow for each
connector the pack supports. `ingestron init --connector <id> --via adf` starts
a project from it. Each connector's settings are on its page in the
[documentation](https://docs.ingestron.io/docs/connectors).

## Example

```ts
import { loadDefinitions, type Pack } from "@ingestron/definitions";
import { adf } from "@ingestron/pack-adf";

// The platform pack that stores what ADF lands, such as @ingestron/pack-databricks.
declare const platform: Pack;

const result = loadDefinitions("definitions", { packs: [platform, adf], environment: "prod" });
if (result.model) for (const path of Object.keys(adf.build(result.model))) console.log(path);
```

Microsoft's published Data Factory resource schema (2018-06-01) predates the
current linked services, so it cannot validate this output; the tests check
the shapes in the sources below and in [spec/references.md](spec/references.md).

## Sources (accessed 2026-10-25)

Microsoft Learn: [connector overview](https://learn.microsoft.com/en-us/azure/data-factory/connector-overview),
[SQL Server connector](https://learn.microsoft.com/en-us/azure/data-factory/connector-sql-server),
[Parquet format](https://learn.microsoft.com/en-us/azure/data-factory/format-parquet),
[ADLS Gen2 connector](https://learn.microsoft.com/en-us/azure/data-factory/connector-azure-data-lake-storage),
[Key Vault secrets](https://learn.microsoft.com/en-us/azure/data-factory/store-credentials-in-key-vault),
[tumbling window triggers](https://learn.microsoft.com/en-us/azure/data-factory/how-to-create-tumbling-window-trigger),
[source control](https://learn.microsoft.com/en-us/azure/data-factory/source-control).
For `after_copy` (accessed 2026-11-01): Container Apps
[Jobs - Start](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/jobs/start),
[Job Execution](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/job-execution/job-execution),
[Jobs - Stop Execution](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/jobs/stop-execution)
and [jobs and their roles](https://learn.microsoft.com/en-us/azure/container-apps/jobs).

## Dependencies

[`@ingestron/definitions`](https://www.npmjs.com/package/@ingestron/definitions), as a peer dependency.

## Working on this pack

```sh
pnpm install
pnpm validate   # format, licences, lint, types, tests, README code and API report
```

Requires Node 22.13 or later and pnpm 10. How code is written here:
[CONTRIBUTING.md](CONTRIBUTING.md). Security: [SECURITY.md](SECURITY.md).

## Contact

Questions and feedback: hello@ingestron.io. Security reports: security@ingestron.io
(see [SECURITY.md](SECURITY.md)).

## Documentation

User documentation: https://docs.ingestron.io.

## Licence

Licensed under the [Apache License 2.0](LICENSE); see [NOTICE](NOTICE). Made by
[IntentLabs](https://intentlabs.dev).
