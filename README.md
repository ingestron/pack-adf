# @ingestron/pack-adf

The Azure Data Factory pack: copies data from sources the data platform
cannot reach into a landing folder, where a store pack loads it. Use it after
the pack that stores the landed files, such as Databricks:

```yaml
packs: [databricks@2, adf@2]
```

## Methods

| Method      | Copies                                                                                         | From                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `adf-copy`  | Tables as Parquet: only the contract's columns, the whole table or only the window's changes   | The SQL Server family: SQL Server, Azure SQL Database and Managed Instance, Synapse, RDS        |
| `adf-table` | Whole tables as Parquet (JSON for Microsoft 365); the store decides whether to append or merge | ADF's other native connectors: databases, SAP, SaaS applications, exports and protocols         |
| `adf-files` | Files as they are                                                                              | File shares, HTTP, FTP and SFTP, HDFS, and cloud file stores (Azure, Amazon S3, Google, Oracle) |

The pack's rules choose them for private sources (`connectivity: private`); a
flow can name one for any connectivity.

The output is one factory for every environment, which Microsoft's CI/CD
deploys unchanged: the factory's Git folder, `factory/`, with the first
environment's values, and an ARM parameter file per environment,
`parameters/<environment>.json`, with the values that differ. In the factory:
linked services with secrets as Key Vault references, a pipeline per connection
with a copy per table or file set into `<landing>/<object>/`, and a tumbling
window trigger, started in `prod` and `production` and stopped elsewhere.
Key Vaults are shared infrastructure, referenced by name. Each integration
runtime the linked services use is written by name and type only, because
Microsoft's export and deployment scripts need it in the folder; it is never
configured.

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
packs: [adf@2]
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

## Design your pipelines

The standard sets how the generated pipelines look; a flow or table can
override, except where a pipeline's tables must agree.

```yaml
ingest:
  settings:
    adf-copy:
      pattern: foreach # or activities, the default: one Copy per table
      parallel: 4 # foreach: tables copied at once
      activity: { retries: 2, retry_interval: 60, timeout: 120 } # seconds, minutes (10 or more)
      audit_columns:
        _loaded_at: run.trigger_time
        _run_id: run.id
        _source: source.object
      folder: ingestron/${project.id}
      annotations: [finance]
```

- `pattern: foreach` (adf-copy) puts one parameterised Copy inside a ForEach
  over the pipeline's `tables` parameter. Its default value is the generated
  table list, so nothing is read at run time; pass a shorter list to copy some
  tables again. The pipeline also has `windowStart` and `windowEnd`
  parameters, with no default: the tumbling window trigger fills them, and a
  rerun you start by hand must give both (for example `2026-11-01T00:00:00Z` and
  `2026-11-02T00:00:00Z`), or the copies may fail on the empty value. Take the
  shorter list from the `tables` default, because each item must keep all of
  its keys (`table`, `object`, `connection`, `query`, `watermark`, `folder`
  and `file`); the copy reads them as `@item().file` and so on, and a missing
  key fails the run. The tables of one pipeline share `pattern`, `parallel`,
  `activity` and `audit_columns`. A path with date or `{run}` tokens needs
  `pattern: activities`.
- `activity` is the Copy activity's policy, for all three methods.
- `audit_columns` adds columns to every landed row (adf-copy, adf-table): one
  of `run.trigger_time`, `run.window_start`, `run.window_end` (timestamps),
  `run.id`, `run.pipeline`, `source.object`, `source.connection`, or literal
  text such as `${environment.name}`. The packs that read the files are told
  about them (`output.columns`). The run and source names are read in any
  case, so `RUN.ID` means `run.id`. Not offered for sources read by path, or
  Microsoft 365.
- `run.window_start` and `run.window_end` come from the pipeline's
  `windowStart` and `windowEnd` parameters, which the tumbling window trigger
  fills.
  A run you start by hand must give both; with an empty value the column lands
  as empty text, which the packs that read the files cannot cast to a
  timestamp.
- `folder` files the project's pipelines and datasets in the factory, so all
  its ADF tables share it. `annotations` are added to a pipeline, so the tables
  of one pipeline share them; flows can tag their pipelines differently.
- Audit column names must not differ only by case, nor be `_ingestron_file` or
  `_rescued_data`, which the packs reading the files use.

Every pipeline and Copy activity has a description.

## Connector catalogue

`recipesFolder` is a tested project with one connection and one flow for each
connector the pack supports. `ingestron init --connector <id> --via adf` starts
a project from it. Each connector's settings are on its page in the
[documentation](https://docs.ingestron.io/docs/connectors).

## Example

Most people use this through the [`ingestron`](https://www.npmjs.com/package/ingestron) command, which writes the factory to `build/adf/`. In code:

```ts
import { loadDefinitions, type Pack, type ResolvedModel } from "@ingestron/definitions";
import { adf } from "@ingestron/pack-adf";

// The platform pack that stores what ADF lands, such as @ingestron/pack-databricks.
declare const platform: Pack;

const models: Record<string, ResolvedModel> = {};
for (const environment of ["dev", "prod"]) {
  const result = loadDefinitions("definitions", {
    packs: [platform, adf],
    environment,
    deployTime: true,
    environmentsTogether: true,
  });
  if (result.model) models[environment] = result.model;
}
const { files, problems } = adf.buildEnvironments!(models);
for (const problem of problems) console.log(problem.code, problem.message);
for (const path of Object.keys(files)) console.log(path);
```

For a SQL Server connection `erp` this prints:

```text
factory/arm-template-parameters-definition.json
factory/dataset/ds_erp_erp_erp.json
factory/dataset/ds_erp_landing.json
factory/integrationRuntime/shir-erp.json
factory/linkedService/ls_erp_erp_erp.json
factory/linkedService/ls_erp_keyvault.json
factory/linkedService/ls_erp_landing.json
factory/pipeline/pl_erp_erp.json
factory/trigger/tr_erp_erp.json
parameters/dev.json
parameters/prod.json
```

`arm-template-parameters-definition.json` replaces Microsoft's default
parameterisation, so the template has a parameter only for a value that
differs between environments, with no default:

```json
{
  "Microsoft.DataFactory/factories/linkedServices": {
    "AzureKeyVault": { "properties": { "typeProperties": { "baseUrl": "-" } } },
    "AzureBlobFS": { "properties": { "typeProperties": { "url": "-" } } }
  },
  "Microsoft.DataFactory/factories/triggers": { "properties": { "runtimeState": "-" } }
}
```

Each environment's file sets every one, under the name Microsoft's export
gives it:

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "ls_erp_keyvault_properties_typeProperties_baseUrl": {
      "value": "https://kv-erp-prod.vault.azure.net"
    },
    "ls_erp_landing_properties_typeProperties_url": {
      "value": "https://erplake.dfs.core.windows.net"
    },
    "tr_erp_erp_properties_runtimeState": { "value": "Started" }
  }
}
```

Values in a pipeline, such as the after-copy job or an audit column holding
`${environment.name}`, are parameters of the activity that holds them.
A whole value written as `${envvar:NAME}` is left out of the environments
where it is one; `deployValues` names the ARM parameters to supply it as.

## Deploy

One factory serves one project: Microsoft's post-deployment script deletes
every pipeline, dataset, linked service, trigger and integration runtime in
the factory that the template does not hold. Leave the factories unconnected
to Git, or Studio writes files of its own into the folder.

1. Build the template once, from `build/adf/factory`, with
   [`@microsoft/azure-data-factory-utilities`](https://www.npmjs.com/package/@microsoft/azure-data-factory-utilities):
   `npm run build export build/adf/factory <factory resource ID> arm`.
2. For each environment, in order:
   - the pre-deployment script `arm/PrePostDeploymentScript.ps1`, in PowerShell
     Core, with `-PreDeployment $true` and
     `-ArmTemplateParameters build/adf/parameters/<environment>.json`;
   - `az deployment group create --mode Incremental --template-file arm/ARMTemplateForFactory.json --parameters @build/adf/parameters/<environment>.json factoryName=<factory>`,
     adding `<name>=<value>` for each value supplied when deploying;
   - the same script with `-PreDeployment $false`, which deletes what the
     template no longer holds and starts the triggers whose `runtimeState` is
     `Started`.

## What changed in 2.0

- One factory in `build/adf/` for every environment, in place of a factory
  per environment in `build/<environment>/adf/`. Change the standard to
  `adf@2`. Deploying the JSON directly is no longer supported; use the ARM
  template above.
- Resource names are the same as in 1.x, so the first deployment updates each
  factory's resources in place. It also adds each integration runtime the
  linked services use, by name and type only: check first that no runtime in
  test or production is a linked self-hosted runtime, or an Azure runtime with
  its own region, compute or virtual network, which the deployment would set
  to its type alone.
- Environments may differ only in values. Resource names, integration runtime
  names and kinds, and resources built in some environments only are
  `ENVIRONMENTS_DIFFER`; more than 256 parameters is `ARM_PARAMETERS`; a Key
  Vault secret name that differs is the warning `SECRET_NAME_DIFFERS`.
- `${envvar:…}` in the landing folder, in a name, or inside a longer value is
  `DEPLOY_VALUE`: write those values in project.yaml for each environment.
- Triggers outside `prod` and `production` stay stopped, decided by the
  environment's name. A platform that set `mode: production` to start another
  environment's triggers sets `paused: false` in the ADF methods' settings
  instead.
- The PostgreSQL recipe no longer adds `_<environment>` to its names. A
  project started from it renames its resources when it drops the suffix: the
  deployment creates the new ones and the post-deployment script deletes the
  old ones.
- Needs `@ingestron/definitions` 1.8 or later.

Microsoft's export refuses some connectors' resources: the MongoDB collection
datasets, Microsoft 365, and a linked service with a credential (for
`UserAssignedManagedIdentity`). For a few others it adds a secure parameter for
an optional secret that the pipeline must give a value. The details and the
rules are in [spec/behaviour.md](spec/behaviour.md).

Microsoft's published Data Factory resource schema (2018-06-01) predates the
current linked services, so it cannot validate this output; the tests run
Microsoft's export, which validates every resource, and check the shapes in
the sources below and in [spec/references.md](spec/references.md).

## Dependencies

- [`@ingestron/definitions`](https://www.npmjs.com/package/@ingestron/definitions) 1.8 or later, as a peer dependency.
- For tests only, [`@microsoft/azure-data-factory-utilities`](https://www.npmjs.com/package/@microsoft/azure-data-factory-utilities) 1.0.3 (MIT), Microsoft's export. It downloads its build tool from `https://adf.azure.com/assets/cmd-api/main.js`; without a network, set `ADF_UTILITIES_BUNDLE` to a downloaded copy, or its tests are skipped and say why.

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
