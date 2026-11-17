# Azure Data Factory generation

The ADF pack reads the Connection, Flow, Platform and Standard settings. The pack builds native resources; it does not provision shared
infrastructure. Every required user-specific ADF value must be supplied by a
definition or a documented default, including conditional authentication
fields. No generated resource requires a manual configuration edit.

## SQL Server family

`adf-copy` reads `sqlserver`, `azure-sql-database`,
`azure-sql-managed-instance`, `azure-synapse` and `amazon-rds-sqlserver`.
The flow object is `database.schema.table`, with three non-empty parts.
The pack selects the table's columns and renames physical source columns using
SQL Server quoting. Incremental mode uses the existing half-open window.

Connection settings include `server`, and `authentication` (default `SQL`).
SQL and Windows authentication require `user` and a secret-reference
`password`. Windows is supported only by SQL Server and Amazon RDS for SQL
Server. Azure SQL Database, Managed Instance and Synapse additionally accept
`ServicePrincipal` (requiring `tenant`, `client_id`, `client_secret`),
`SystemAssignedManagedIdentity`, and `UserAssignedManagedIdentity` (requiring
`credential`, the name of the factory credential, and `identity`, the resource
ID of the user-assigned managed identity it holds).
Unknown settings, unsupported authentication modes, empty values and literal
credentials must fail validation before building files. Authentication fields
that do not belong to the selected mode must also fail, avoiding ignored
credentials. The connection contains no credential values, only references.

`integration_runtime` names the existing Azure or self-hosted runtime. Windows
authentication requires a self-hosted runtime as an external prerequisite.
`encrypt` and mandatory certificate verification apply. Optional
`host_name_in_certificate` sets the expected TLS host.

Resource grouping, the landing folder, schedule, standards precedence
and fixed settings apply. Two different sources must not share a landing
folder accidentally: conflicting destinations fail with a message directing
the user to choose a distinct landing path in the definitions.

For each credential, `build` writes `credential/<credential>.json`:
`{"name": <credential>, "properties": {"type": "ManagedIdentity", "typeProperties": {"resourceId": <identity>}}}`.
Microsoft's export refuses a linked service whose credential is not in the
folder. `identity` is optional in the connector's settings, but
`UserAssignedManagedIdentity` without it is a method check problem whose
message gives the resource ID's form. A credential name outside ARM's rule (1 to
127 letters, digits, underscores and hyphens, starting and ending with a letter,
digit or underscore) is a method check problem; one credential given two
identities is a pack check problem naming both connections. An identity that
differs between environments is a parameter, as any value. The platform request
asks for each identity to be assigned to the factory before deploying.

Conformance cases in `conformance/sql-family.json` cover native resource
names and authentication requirements. Tests supplement these with output,
selection, boundary, standard and handover checks.

## Native tabular sources

`adf-table` copies a full snapshot from a supported tabular connector into
Parquet. Connection settings are allowlisted per connector, with explicit
native-property mappings and required values. Secrets use Key Vault
references. `object` supplies the native dataset's table/entity selectors;
`query` optionally supplies a native read query only where the connector
supports it. Unsupported incremental modes fail rather than copying a full
snapshot silently. Copy column mappings preserve the table's column names.
The downstream store decides whether snapshots append or merge.

The method shares the existing landing, runtime, Key Vault and window
settings. Its service, dataset and source types are vendor constants, not
user configuration. All objects must be non-empty and must not contain path
traversal or ADF expressions. Shared resources and destination conflicts are
checked with the existing ADF flows.

## Native file stores

`adf-files` also reads Azure Blob Storage, ADLS Gen2, Azure Files, Amazon S3,
S3-compatible storage, FTP, SFTP, Google Cloud Storage, HDFS and Oracle Cloud
Storage. Each connector declares its native service/location/read types and
required connection fields. Object-store objects are `container/folder` or
`bucket/folder`; other file-store objects are relative folders. Copying uses
the existing binary, hierarchy-preserving handover and format/options settings.
SFTP requires host-key validation; FTP requires TLS and certificate validation.
Relative paths reject traversal, backslashes and ADF expressions.

Native source options are validated against each connector's allowlist. Open Hub
exposes `exclude_last_request` (false for full snapshots); Web tables require a
zero-based table index. Hierarchical sources use JSON paths for the table's columns,
with an optional collection reference for REST arrays. PostgreSQL and Greenplum
fix SSL verification to the vendor's numeric value 5. Ports remain configurable.
Snowflake and Databricks Delta exports require an Azure Blob SAS staging secret
and a relative staging path; their linked service is generated from definitions.
Restricted connectors require the matching declared runtime kind. Microsoft 365
requires JSON landing and application authentication for both source and landing;
its date-filter requirement is explicitly declared and uses the trigger window.
Its copy is a `BinarySink` into a `Binary` dataset of a folder: Microsoft's
export accepts no other sink for a Microsoft 365 source, and no file name.
Microsoft writes the files as JSON, one object per line, and names them.

The MongoDB, MongoDB Atlas and Azure Cosmos DB for MongoDB datasets write the
collection as `typeProperties.collection`, the name in their ARM model and the
one Microsoft's export requires; the connector pages say `collectionName`,
which the export refuses. `conformance/native-sources.json` states their
dataset properties.
Resource paths and overlapping landing paths must be checked before building.

REST accepts Anonymous, Basic or OAuth2ClientCredential authentication, with only
the fields required by the selected mode. Optional authentication headers are
secret references. REST pagination uses documented rule keys; source extraction
and collection selection are definition settings. HTTP copies one relative URL
to a named file with `mode: all`; FTP also requires `mode: all` because its native
reader has no modified-time filter. Unsupported combinations fail validation.
Connector metadata distinguishes optional fields and primitive types; generated
connection snippets include only the default authentication path's required fields.

## Definition-driven resource names

All three ADF methods accept `resource_names` in their settings. Each value is
a literal name after the `${project.id}`, `${environment.name}` and
`${values.…}` references resolve; there is no template syntax or naming layer of
its own. An omitted role keeps the name derived from the project, connection,
database or table.

The configurable roles are Key Vault and landing linked services, Parquet,
binary and HTTP landing datasets, source linked service and dataset, pipeline,
trigger, staging linked service, Microsoft 365 JSON linked service and dataset,
and Copy activity. Runtimes and credentials take the names their settings give
(`integration_runtime`, `credential`); the factory is not generated.

Shared resource names must agree for every table using that resource; SQL
source datasets are per connection/database, file datasets per connection,
native table datasets per table. Names are used consistently in resource JSON,
file paths, references, previews and platform requests. A naming override does
not change grouping or create an extra resource. Standard fixed settings and
normal setting precedence still apply. Naming presets may contain known roles for resources that a source does not
generate; those roles are accepted but unused and must not be resolved against
that source's groups or defaults. Values still meet the schema. Unknown roles
fail. Supplying a name never creates an additional resource.

The accepted portable subset starts with an ASCII letter and continues with
letters, digits or underscores; pipelines, triggers and activities also allow
hyphens. Names are limited to what Microsoft's export accepts: 140 characters
for a linked service, dataset, pipeline or trigger (the export allows 141 for
linked services and triggers) and 55 for an activity. The limit is in the
`resource_names` schema, and a default name over it is a pack check problem
that names the name, its length and the role to set. Names derived from others,
such as after_copy's parent pipeline, and activities inside a ForEach are
checked last, with the same limits. `conformance/resource-names.json` records
them. Invalid names, unknown name roles,
case-insensitive resource collisions and duplicate activities fail before
writing. No sanitisation silently changes a supplied name. Renaming uses the
generated manifest to create the new paths and remove the old ones it owns.

REST OAuth2ClientCredential accepts optional `resource` as well as `scope`.
Other authentication modes reject those fields. HTTP `source_options` accepts
`request_method` (GET by default or POST) and `request_body` (POST only);
other file connectors reject HTTP options. Native output is `requestMethod`
and `requestBody`, without manual resource edits.

## File sources without secrets

`adf-files` does not require `key_vault` when neither its source connection nor its
method settings contain a secret reference. Any nested `$secret` reference still
requires a Key Vault. Omitting an unused vault omits its linked service and
prerequisite; it must never generate the string `undefined` as a vault URL.
A flow that supplies a vault keeps its linked service. Managed-identity
Blob/ADLS file copying needs only the factory's identity and storage
permissions.

For native `adf-files` sources, `runtime_kind: azure` with
`integration_runtime: AutoResolveIntegrationRuntime` selects ADF's implicit default
Azure runtime: omit `connectVia`. Other named runtimes keep an explicit
`IntegrationRuntimeReference`. File System and HDFS still require self-hosted
runtime validation. See `conformance/default-file-runtime.json`.

## Landing layouts

`adf-copy` and `adf-table` take `layout` (`snapshot` or `increments`) or a
`path` pattern, usually placed in the standard. When both are set, the one set
closer to the table wins, by the layers of section 3 of the definitions
specification; both set in the same place is a method check problem, and so is
setting one where the standard fixes the other. Without either, a table that
ends at the landed files (`store: none`) uses `snapshot`, and any other table
`increments`; a table whose runs each hold only their window (`mode:
incremental`, or a `source_options.date_filter_column`) always defaults to
`increments`.

- `snapshot` writes `<landing>/<object>/<object>.parquet`, replaced by each run.
- `increments` writes `<landing>/<object>/<windowStart yyyyMMddHHmmss>_<run id>.parquet`;
  for Microsoft 365, Microsoft names the files in `<landing>/<object>/`.
- A `path` pattern is relative to the landing folder, includes `{object}`, ends
  in a file name with the format's extension, and uses only the tokens
  `{object}`, `{connection}`, `{yyyy}`, `{MM}`, `{dd}`, `{HH}` (the window's
  start), `{run}` (the run id) and `{parameters.<name>}` (a parameter of the
  flow). It must not start with `/`, have an empty
  folder name, use `.` or `..` as a folder, have a brace outside a `{token}`,
  or have a folder or file name that ADF reads as an expression (starting with
  `@`, or holding `@{`). Each problem is a method check problem.
- `{parameters.<name>}` names a parameter the flow declares, or a built-in:
  `windowStart` and `windowEnd`, and `load` when a trigger of the flow sets it.
  Any other name is a method check problem, with the message
  `{parameters.<name>} names no parameter of the flow.` It is written into the
  sink path as an expression over `pipeline().parameters.<name>`, by the parameter's type, and is a `*` in
  the reported location, like the date tokens. A `date` is
  `formatDateTime(…, 'yyyy-MM-dd')`; a `datetime`, `windowStart` and
  `windowEnd` are `formatDateTime(…, 'yyyy-MM-ddTHHmmss')`, with no colon;
  an `int`, `float` or `bool` is `string(…)`; a `string` and `load` are
  `replace(replace(replace(…, '/', '_'), '\', '_'), '..', '_')`, so a value
  typed by hand cannot change the folder structure, and nothing is refused at
  run time. Like the date tokens, it is a run-time token for the rule under
  `pattern: foreach`, below.

An object whose name starts with `@` or holds `@{` is a method check problem.

Each copy writes one file (no `maxRowsPerFile`). Each method reports its output:
the file, or a wildcard pattern with one `*` for each run of date or run tokens
(`<object>/*.parquet` for increments); the format; and `add` when each run
writes its own file, else `replace`. A path writes its own file per run when it
has `{run}`, or the date tokens down to the window's unit: `{yyyy}`, `{MM}`,
`{dd}`, `{HH}` for `Hour`; `{yyyy}`, `{MM}` for `Month`; only `{run}` for
`Minute`. `adf-files` reports `<landing>/<object>/**` with `add` when its
`format` is `csv`, `parquet` or `json`, and no output otherwise.

A table whose runs each hold only their window, with a layout that replaces one
file and no store step, is a method check problem: the next run would overwrite
the rows before anything merged them. A table whose path pattern lands where
another tabular table's files land is a pack check problem; tables with
`snapshot` or `increments` are checked by their `<landing>/<object>/` folders.

Microsoft 365's landing dataset, shared by a connection's tables, takes only a
folder. A Microsoft 365 table with `snapshot` (also its default without a date
filter) or a `path` is a method check problem whose fix is `layout:
increments`, with a date filter so that each run lands only its window.

## Copy activity policy

The design setting `activity` sets the Copy activity's `policy`; keys left out
use ADF's defaults. `retries` is 0 to 10 and becomes `retry`. `retry_interval`
is 30 to 86400 seconds and becomes `retryIntervalInSeconds`. `timeout` is
whole minutes from 10 to 10080 and becomes `timeout` as `d.hh:mm:ss`. The
minimum of 10 minutes is ADF's own (see `references.md`); a smaller value is a
settings problem, so no generated file carries a timeout ADF would refuse.

## Design settings

An audit column (`audit_columns`) names the value it holds. Its schema is
either one of the pack's values or any other text, so that a reference lists
the values with their meanings. A value that is
`run.` or `source.` followed by one of the names the pack lists is matched in
any case (`RUN.ID` and `run.id` are the same) and is generated in its canonical
lower-case form: the ADF expression or literal for that name, with the column's
type. Any other text is landed as written. Text that starts with `run.` or
`source.` in any case but is not one of those names is a method check problem,
as is text that starts with `@` or holds `@{`, which ADF would read as an
expression.

`run.parameters.<name>` (in any case of `run.parameters`) is a further value:
the pipeline's parameter `<name>`, as the expression
`@pipeline().parameters.<name>`, in a column of type `string`. The name must be
a parameter the flow declares, or `windowStart`, `windowEnd`, or `load` when a
trigger of the flow sets it; otherwise it is a method check problem naming the
audit column: `audit column "<column>" uses "<value>", which names no parameter
of the flow`.

Under `pattern: foreach`, a path with date or run tokens is a method check
problem. It is refused only when the path is the layout in use: if a `layout`
is set closer to the table than the `path` (in the flow, for example), the
layout wins, the path is not used, and the table is not refused. A path with
only `{object}` and `{connection}` is not refused by this rule.

## Intent

The pack declares what it does with each intent path and value (section 11 of the
definitions specification) in `intent`, and `intentCoverageGaps` is empty. A path
or value it does not build is `not-yet` with the reason "Planned.", except the
`access` paths, which are `not-applicable` (Access, below).

ADF only lands files. The core judges `load.mode`, `load.cursor` and
`retention.landed_files` at the ingest step, and `load.deletes`, `history`,
`sequence`, `rescued`, `storage.*`, `retention.time_travel`, `retention.log` and
`quality.results` at the store step.
When a table ends at the landed files (`store: none`) the ingest step judges every
path. The store-owned paths are therefore `not-applicable` with the reason "ADF only
lands files; nothing keeps the table.": on a stored table the store's pack judges
them, and on a table that ends at the files nothing keeps it. The step that
writes the table judges `load.deletes`: the store step on a stored table, and
this pack on a table that ends at the landed files, where `load.deletes` is
`not-yet` ("Planned."), so a delete condition there is reported.

The checking and cleansing paths (`quality.rules`, `quality.actions`,
`quality.table-checks`, `quality.quarantine`, `cleanse.trim`, `cleanse.empty`,
`cleanse.map`, `cleanse.case`, `cleanse.default`, `cleanse.timezone` and
`deduplicate`) are `not-applicable` with the reason "The files are landed as the
source gives them; check and cleanse them in the table that reads them." The pack
copies the files as the source gives them and checks and cleanses nothing. On a
stored table the store step's pack does this work, and on a table that ends at the
landed files the core reports each check with `NOT_APPLIED` and the hint to add a
store step. `quality.results` stays with the store-owned paths above: ADF keeps no
results because nothing keeps the table.

Used, all generally available (status checked 2026-11-09, sources in
`references.md`):

| Intent                                                                              | What the pack does                                                                                                                                                     |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `load.mode: full`                                                                   | `adf-copy` and `adf-table` copy the whole selection each window.                                                                                                       |
| `load.mode: files`                                                                  | `adf-files` copies the files changed in the window.                                                                                                                    |
| `load.mode: incremental`, `load.cursor`                                             | `adf-copy` copies the rows past the watermark column in the window.                                                                                                    |
| `audit: run_id`, `window_start`, `window_end`, `source_object`, `source_connection` | An additional column of the copy source: `run.id`, `run.window_start`, `run.window_end`, `source.object`, `source.connection`.                                         |
| `audit: loaded_at`                                                                  | An additional column of `run.trigger_time`, only when the table ends at the landed files. Otherwise the store step writes the table and adds it, and ADF adds nothing. |
| `operations.retries`                                                                | The tumbling window trigger's retry count. The wait stays five minutes. On a flow's tumbling windows, the count and wait, unless the trigger writes its own.           |
| `operations.concurrency`                                                            | On a flow's tumbling windows, `maxConcurrency`, unless the trigger writes its own.                                                                                     |
| `operations.timeout`                                                                | The Copy activity's timeout.                                                                                                                                           |
| `operations.schedule: project`                                                      | Tumbling window triggers from the methods' schedule settings, the same for every flow. `operations.schedule: flow` is the flow's own triggers.                         |

`adf-copy` also leaves `load.mode: files` to `adf-files` and `adf-table` has no
incremental load; `adf-files` copies files as they are, so it adds no columns. Each
is `not-applicable` on that method.

### Access

ADF lands files and keeps no table, so it has no access to grant, mask or
filter on a table. Storage access is set on the storage account, not in the
pipelines. Every `access` path and value is `not-applicable` with the reason
"Landed files are outside the tables; storage access is set on the storage
account." on every method: `access.grants` (`read` and `write`),
`access.exact`, `access.masks` (every mask) and `access.filters`. A role, an
exact grant mode, a mask or a filter that reaches ADF is `NOT_APPLIED`, a
warning, as for any other path. On a stored table the store step's pack
judges access; on a table that ends at the landed files, where nothing keeps
the table, the definitions package resolves none (definitions specification,
section 8.2). The pack generates no grant, mask or filter, so its files are the
ones it built before access existed.

### Settings that are other names for intent

On `adf-copy`, `mode` is `load.mode` (`full` or `incremental`) and `watermark_column`
is `load.cursor`. The methods' intent defaults are `load.mode: full` for `adf-copy`
and `adf-table`, and `load.mode: files` for `adf-files`. A setting written is
`SETTING_MOVED`, as the core reports for every alias, and builds the same files as
the intent.

### Audit columns from the layer

The audit values the table's intent names are added after the columns of
`audit_columns`, each named by the intent's `as` (`_run_id` unless renamed), on
`adf-copy` and `adf-table` and described in the landed output like any audit column.
A column named in both `audit_columns` and the layer's audit is a method check
problem: `the audit column "<as>" is named twice: in audit_columns and in the layer's
audit`. The layer's audit gets the other checks of `audit_columns` (the name, a clash
with the table's columns, case). Sources read by path refuse it, like `audit_columns`.
Under `pattern: foreach` the tables of one pipeline must agree on it.

### Operations

`retries` and `activity.timeout` stay settings, and they win. When a table leaves
them out, the pipeline takes `operations.retries.count` for `retries` (else 2, which is
no longer a method default) and `operations.timeout` for `activity.timeout`,
converted to minutes, rounded up and kept within the setting's 10 to 10080 minutes.
Moving these two settings to intent, with `SETTING_MOVED`, is planned.

### The Platform section

The Platform's `adf` section is empty: `platformSection` has no properties, so `adf: {}`
is valid and any key in it is `BAD_SETTING`.

## Starting a job after the copies

`after_copy` is a platform setting of every ADF method, set under each method a
project uses: `job`, the resource ID of an Azure Container Apps job,
`/subscriptions/<subscription GUID>/resourceGroups/<group>/providers/Microsoft.App/jobs/<name>`,
and `timeout`, how long ADF waits for the job's run, as `[d.]hh:mm:ss` with
hours, minutes and seconds in range (default `01:00:00`), more than zero and at
most 90 days. Either out of form is a method check problem. Every ADF table
must use the same `after_copy`, or none.

With `after_copy`, the connection pipelines have no triggers. Triggers with the
same window size, start and state become one parent pipeline and one trigger,
which passes the window to the parent and does not retry; each connection
pipeline's Copy activities take its trigger's retries and interval as their
`policy`, so a retry never copies the schedule again or starts the job twice.
Retries alone never split a schedule.

The parent is `pl_<project>_every_<interval>_<frequency, lower case>` and its
trigger `tr_` with the same name. Started schedules are named before stopped
ones, each in order of start; the first of a size takes the plain name, and
another is named by what differs from it: `_from_<yyyyMMdd>` (with `HHmm`, or
`HHmmss` when seconds are set, in UTC) for a different start, then `_stopped`
when it is stopped and the first is not, then a counter if that is still taken.
A parent name that a generated pipeline already has is a pack check problem.

The parent:

1. runs each connection pipeline (`run_<pipeline>`, ExecutePipeline, waiting,
   passing the window), with no order between them; an activity name longer
   than ADF's 55 characters becomes `run_<first 44 characters>_<6-character hash>`;
2. `start_job`: after all of them succeed, POST
   `https://management.azure.com<job>/start?api-version=2026-07-01` with the
   factory's managed identity and no retry; `remember_job` keeps the run's
   name (`output.name`) in the variable `execution`, failing at once without
   one;
3. `wait_for_job`: until the run's status is not `Running`, `Processing`,
   `Degraded` or `Unknown`, wait 30 seconds and GET
   `…/executions/<execution>?api-version=2026-07-01` (three retries, 30
   seconds apart), within `timeout`; a GET that still fails sets the status to
   `unreadable: <error>`, which ends the wait;
4. `check_job`: fail with the status unless it is `Succeeded`;
5. when `wait_for_job` fails, `stop_job` POSTs `…/executions/<execution>/stop`;
   `job_timed_out` fails the pipeline when it stopped, `job_not_stopped` with
   the error when it did not.

`request` adds the factory's role on the job; the job's replica timeout (half
of `timeout`, in seconds) and retry limit (1); and, because new triggers run
every window since `start`, to set `start` to the next window when turning
`after_copy` on.

## Triggers and parameters

A flow may write `triggers` and `parameters` under its `ingest` (definitions
specification, section 5.1). The tables of a flow that writes either leave
the connection's pipeline and share a pipeline of their own; every other
table keeps the pipeline it always had, so a project whose flows write
neither generates the same files as before.

- **Grouping.** `groupKey` gives `<connection>` for a table whose flow writes
  neither, and `<connection>/<flow>` for one whose flow writes either; the
  flow is the table's origin. The `adf-copy` groups add the source database
  to the key, as before. Tables with one key share a pipeline, a trigger
  and their annotations; the settings the pack requires a group to share
  are checked for each group.
- **Names.** The connection's pipeline and trigger are `pl_<project>_<connection>`
  and `tr_<project>_<connection>`, with `_<database>` where `adf-copy` names it.
  A flow's own are the same with `_<flow>` added at the end, and
  `resource_names.pipeline` and `resource_names.trigger` replace them as
  before. A name generated twice with different content is refused.
- **Shared resources.** Groups of one connection (and database) share its linked
  service, source dataset and export-only resources, which are written once.
  The settings that feed them (`integration_runtime`, `runtime_kind`, and
  `encrypt` for `adf-copy`, `staging_sas` for `adf-table`) must agree across all
  the groups, whether or not a flow has a pipeline of its own; the check
  names them as it does within one group. A repeat that differs from what was
  written is refused as generated more than once, never settled by the first.
- **Parameters.** A pipeline of a flow's own declares, after `windowStart` and
  `windowEnd` (and `tables` under `pattern: foreach`):
  - each parameter the flow declares, as `{ type, defaultValue }` with the ADF
    type below and the declared `default`, escaped as a literal (below);
  - `load`, `{ type: "String", defaultValue }`, only when a trigger of the
    flow sets `load`; the default is `incremental` when any table of the
    group has load mode `incremental`, else `full`.

  | Ingestron                    | ADF      |
  | ---------------------------- | -------- |
  | `string`, `date`, `datetime` | `String` |
  | `int`                        | `Int`    |
  | `float`                      | `Float`  |
  | `bool`                       | `Bool`   |

  A pipeline without a flow of its own declares nothing more.

- **Default trigger.** A pipeline whose flow writes parameters but no
  triggers has the one tumbling window trigger the methods' settings describe,
  as every other pipeline does.
- **A flow's triggers.** A pipeline whose flow writes triggers has one ADF
  trigger for each, in `trigger/` and instead of the default trigger. Each
  passes the trigger's `parameters`: a literal as written, escaped as below,
  and `{ expression }` as `{ "type": "Expression", "value": <expression> }`.
  ADF evaluates a string that starts with `@`, and `@{…}` inside any string,
  so a literal string, here and in a parameter's `defaultValue`, has a
  leading `@` written `@@` and each `@{` written `@@{`, which ADF reads back
  as the text written (`@home` is written `@@home`). Its
  `runtimeState` is `Stopped` when the trigger writes `paused: true`, else as
  for every trigger (see "Triggers" under the next section).
  - A `schedule` trigger is a `ScheduleTrigger` with one `pipelines` entry, the
    flow's pipeline and its parameters: first `windowStart` and `windowEnd`
    (see "A schedule's window"), then the trigger's own. Its `recurrence` has
    `frequency`, `interval`, `startTime`, `endTime` when written, `timeZone`
    and, from `at`, a `schedule` of `weekDays`, `monthDays`,
    `monthlyOccurrences` (`{ day, occurrence }`), `hours` and `minutes`.
    `timeZone` is the Windows name of the trigger's zone (CLDR
    `windowsZones`, `src/triggers/windows-zones.ts`). In `UTC`, times are
    written `yyyy-MM-ddTHH:mm:ssZ`; in any other zone, as the zone's local
    time `yyyy-MM-ddTHH:mm:ss`, converted from `start` and `end` as written
    (with `Z` or an offset, an instant; without, already the zone's local time).
  - A `tumbling-window` trigger is a `TumblingWindowTrigger` on the flow's
    pipeline, passing `windowStart` and `windowEnd` from
    `@trigger().outputs.windowStartTime` and `windowEndTime` before the
    trigger's parameters. It has no `timeZone`: `startTime` and `endTime` are
    converted to UTC. `delay`, a dependency's `size` and `offset` are written as
    timespans, `[-][d.]hh:mm:ss`. `maxConcurrency` is the trigger's
    `concurrency`, else the standard's `operations.concurrency.max_runs`, else 1.
    `retryPolicy` is the trigger's `retries`, else the standard's
    `operations.retries`, with the interval in seconds; else, as for the
    default trigger, the method's `retries` (2 when none) every 300 seconds.
    A dependency on itself (`self: true`, or its own `<flow>/<name>`) is a
    `SelfDependencyTumblingWindowTriggerReference`; one on another trigger is a
    `TumblingWindowTriggerDependencyReference` naming that trigger's generated
    name. A dependency on a tumbling window this pack does not write, such as
    another pack's in a project that uses both, is a check problem (see "What
    ADF refuses"), and the trigger that depends on it is not written. It has the `annotations` `ingestron:flow-trigger`, which marks it as
    one a flow writes, and `ingestron:backfill` too when the trigger writes
    `backfill: true`. The default trigger has no annotations, so its file is
    as it was before flows wrote triggers.
- **Backfill.** ADF runs every window from a tumbling window's `startTime` to
  now when the trigger is published. The pack's `checkFirstWrites` (definitions
  specification, section 2.1) refuses such a file, as one problem for each,
  when all of these hold:
  - its path has a `trigger/` folder, wherever that is (the Synapse pack copies
    these files under its own folders);
  - it is a `TumblingWindowTrigger` with the `ingestron:flow-trigger`
    annotation, and no `ingestron:backfill` one;
  - its path is not in `generatedBefore`, the paths the output folder's
    manifest lists. A first generation, which lists none, refuses it too, and
    so does a rename: a change of frequency or interval names a new file;
  - its `startTime` is before `now`, and at least one window has ended since:
    a start less than one window ago leaves nothing to run again.

  Default triggers are never checked, whatever their `start` and whether or not
  the folder has a manifest: a project that writes no triggers must keep
  generating as it did, and nothing there could confirm the start.

  The message, with `<trigger>` the trigger's name, `<start>` its `startTime`
  and `<n>` the number of windows that have ended between them (Minute and Hour
  windows by their length; Month windows by calendar months in UTC, keeping to
  the last day of a shorter month):

  ```text
  <trigger> is new and starts at <start>: ADF would run <n> past windows again. Move `start` to now or later, or write `backfill: true` on the trigger.
  ```

- **A schedule's window.** A schedule trigger passes the window a tumbling
  window passes itself, from its `lookback` (a duration, written as minutes
  and rounded up when it is not whole minutes). For a lookback of `2h`:

  ```text
  windowStart  @formatDateTime(addMinutes(trigger().scheduledTime, -120), 'yyyy-MM-ddTHH:mm:ssZ')
  windowEnd    @trigger().scheduledTime
  ```

  With `load: full`, or no lookback, both are `@trigger().scheduledTime`, so
  they record when the run happened. With `after_copy`, the schedule's
  parent pipeline declares and passes both on to the flow's pipeline and the
  job, so the copies and the job see the same window.

- **The `load` switch.** When a trigger of the flow sets `load`, an
  incremental table's source query becomes an expression that reads the
  pipeline's `load` parameter: a full run selects every row, and any other
  only those in the window. The select is written once, as the text of an
  interpolated string (each `@{` in it written `@@{`), and only the WHERE part
  switches, so a long select does not count twice towards ADF's limit on an
  expression. Single quotes inside the branches are doubled.

  ```text
  <select>@{if(equals(pipeline().parameters.load,'full'), '', concat('\nWHERE <column> >= ''', <windowStart>, '''\n  AND <column> < ''', <windowEnd>, ''''))}
  ```

  `<windowStart>` and `<windowEnd>` are `formatDateTime` of the pipeline
  parameter, as an unswitched query writes them. A full table's query never
  reads `load`, and a table of a flow that sets no `load` keeps the query it
  had. Under `pattern: foreach` the item's window filter is left out when
  `load` is `full`. A further predicate, such as a filter, is added as
  `WHERE (<predicate>)` on the full branch (`''` when there is none) and
  after the window on the incremental one: `WHERE (<window>) AND (<predicate>)`.

- **The source filter.** `adf-copy` filters source rows: a table's
  `ingest.filter`, written in SQL Server's dialect, narrows the query as
  `WHERE (<filter>\n)`, or `WHERE (<window>) AND (<filter>\n)` in an
  incremental table, in every form of the query (plain, the `load` switch's
  branches and `pattern: foreach`). The closing parenthesis is on a line of
  its own, so a filter that ends in a `--` comment cannot comment it out.
  Definitions refuses a filter whose parentheses do not balance, which
  would escape the pack's. Each `{{ parameters.<name> }}` becomes a typed, escaped piece of an
  ADF expression, never raw text, because a run started by hand can pass any
  value:

  | Parameter type | Rendered as                                                           |
  | -------------- | --------------------------------------------------------------------- |
  | `string`       | `'@{replace(pipeline().parameters.x, '''', '''''')}'`                 |
  | `date`         | `'@{formatDateTime(pipeline().parameters.x, 'yyyy-MM-dd')}'`          |
  | `datetime`     | `'@{formatDateTime(pipeline().parameters.x, 'yyyy-MM-dd HH:mm:ss')}'` |
  | `int`, `float` | `(@{int(pipeline().parameters.x)})`, `(@{float(…)})`                  |
  | `bool`         | `@{if(bool(pipeline().parameters.x), '1', '0')}`                      |

  A string's single quotes are doubled. A number is in parentheses so a negative value cannot form a `--` comment. A
  date or datetime is read by ADF, so a value that is not one fails the
  expression instead of reaching the source. The built-in `windowStart` and
  `windowEnd` render as datetimes, quoted as the window does, and `load`
  renders as a string; neither needs declaring.

  A reference stands in plain SQL code, which definitions enforces: never
  inside `'…'`, `"…"`, `[…]` or a comment, because the pack's quotes would
  then close the text early. To match part of a value, join it in code:
  `name LIKE '%' + {{ parameters.p }} + '%'`, not `name LIKE '%{{ parameters.p }}%'`.

  Under the `load` switch the filter narrows both branches. Under
  `pattern: foreach` the query expression builds each table's filter itself,
  for the item whose `table` names it (an expression inside an item's text is
  never evaluated), so the filter does not depend on the item. The escaping
  covers parameter values. A person who can start a run with a `tables` value
  of their own can already change the source query, as before. Text outside
  the references is the filter as written. A query with no filter is as it
  was.

  The pack refuses, as check problems: a `date` or `datetime` parameter whose
  default, or whose literal value in a trigger, is not a real date and time
  (the message names the parameter); and a filter that reads
  `{{ parameters.load }}` when no trigger of the flow sets `load`, since the
  pipeline then has no such parameter.

  ADF allows at most 8,192 characters in one expression (see
  `references.md`, "Expressions"). A query that reads parameters is one
  expression, and grows with its columns and filter, and under
  `pattern: foreach` with every filtered table of the group. The pack
  refuses, as a check problem, a query longer than that, and a trigger's
  expression longer than that:

  ```text
  The query of the table "<table>" is an ADF expression of <n> characters; ADF allows at most 8,192 characters in an expression. Shorten its filter, or copy fewer columns.
  The trigger "<flow>/<name>" passes "<parameter>" an expression of <n> characters; ADF allows at most 8,192 characters in an expression.
  ```

  Under `pattern: foreach` the first names the group's tables:
  `the tables "<a>", "<b>"`. `<n>` is written with thousands separated by
  commas.

- **Trigger names.** A schedule is `tr_<pipeline>_<name>` and a tumbling
  window `tr_<pipeline>_<name>_<size>`, where `<pipeline>` is the flow
  pipeline's name without `pl_`, and `<size>` is `m`, `h` or `mo` for
  `Minute`, `Hour` or `Month` followed by the interval, such as
  `tr_erp_erp_b_hourly_h1`. ADF cannot edit a published tumbling window's
  frequency or interval, so changing either names a new trigger rather than
  editing the old one.
- **What ADF refuses.** Each is a pack check problem naming the trigger
  (`"<flow>/<name>"`) and the limit, before anything is generated:
  `at.weekdays` without `Week`; `at.month_days` or `at.occurrences` without
  `Month`; an interval outside 1–1000; a tumbling window by `Day` or `Week`,
  or under 5 minutes; `concurrency` outside 1–50; a retry interval under 30
  seconds; more than five dependencies; a dependency on itself (either
  form) without a negative offset; an `end` not after `start`; a zone with no
  Windows name; and a second tumbling window on one flow's pipeline, which
  would load each window twice. Two more are about the flow as a whole:

  ```text
  "<flow>/<name>" depends on "<flow>/<target>", which this pack does not generate; a tumbling window can depend only on another of this factory's tumbling windows.
  The flow "<flow>" copies tables from more than one database and writes its own triggers; split it into one flow per database.
  ```

  The first is for a dependency on a tumbling window that no flow of this
  pack writes (definitions only checks that the project has one). The second
  is for a flow whose `adf-copy` tables are in more than one source database:
  each database has a pipeline of its own, so each would carry a copy of the
  flow's triggers, and a dependency on one of them could name only the
  first. A flow that writes no triggers keeps one default trigger for each
  pipeline, as before. The schema refuses an `interval` over 1000 and a
  `concurrency` outside 1–50 where they are written; the pack keeps its own
  checks for a value it takes from the standard. A tumbling window that writes no
  `concurrency` or `retries` is held to the same limits for the values it
  takes from the standard's `operations.concurrency.max_runs` and
  `operations.retries`, and the message says where they came from.

- **The standard's rules and the default trigger.** The default trigger is
  judged as a tumbling window in UTC, from the method's `every`, `start` and
  `retries`. A standard whose `operations.triggers.types` leaves out
  `tumbling-window` gets:

  ```text
  The standard allows only <types> triggers. The default trigger "<name>" is a tumbling-window trigger; write the flow's own triggers, or ask for tumbling-window in the standard's `operations.triggers.types`.
  ```

  A run start outside the standard's `operations.triggers.hours` gets the
  message definitions gives for a flow's trigger, with the default trigger's
  name:

  ```text
  "<name>" starts a run at <HH:mm> (<zone>), outside the hours the standard allows here: <from>–<to>.
  ```

- **After the copies.** With `after_copy`, a trigger a flow writes keeps its
  name, settings and dependencies, and starts a parent pipeline of its own,
  `pl_<trigger name without tr_>`. The parent declares each parameter the
  trigger passes, as the flow's pipeline declares it, runs the flow's pipeline
  passing each on, then the job, as the next section describes. A tumbling
  window's retries move onto the flow pipeline's Copy activities and its own
  retry count becomes 0. The default triggers are grouped into parents as
  before, without the flows' triggers.

## One factory for every environment

`adf@2` builds environments together (definitions specification, section 2.1):
`buildEnvironments` gives one factory for every target, which Microsoft's
CI/CD deploys unchanged: the npm package `@microsoft/azure-data-factory-utilities`
exports one ARM template from the factory's folder, and each stage deploys it
with its own parameter file. One factory serves one definitions project:
Microsoft's post-deployment script deletes every pipeline, dataset, linked
service, trigger and integration runtime in the target factory that the
template does not hold.

### Files

Relative to the pack's output folder:

- `factory/`, the factory's root folder, which the export reads: the resources
  of the first target, in ADF's Git folders, with
  `arm-template-parameters-definition.json`;
- `parameters/<target>.json`, an ARM deployment parameter file
  (`$schema` `https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#`,
  `contentVersion` `1.0.0.0`) for each target.

The factory holds the first target's values, so it reads and validates as a
working factory. Where the first target takes a deploy-time value, the
factory holds `<value of NAME>`. Every file is JSON written with tabs and a
final new line. `factoryName` is in no parameter file: each stage supplies it.

`build(model)` gives one target's resources in the same folders, without
`factory/`: `render(e)` of the fold property.

### Integration runtimes

`build` writes `integrationRuntime/<name>.json` for each runtime a linked
service connects through, other than `AutoResolveIntegrationRuntime`. The
export drops a `connectVia` to a runtime it cannot find in the folder, and the
post-deployment script deletes every runtime the template does not hold, so the
folder holds each runtime the factory uses. An ARM deployment applies a
resource's whole definition and resets what it leaves out, so each runtime is
written as the platform settings describe it:

- `integration_runtime` is its name: 3 to 63 letters, digits and single
  hyphens (`^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$`), as ADF requires.
- `runtime_kind: self-hosted`: `{"type": "SelfHosted"}`, as Data Factory Studio
  writes a runtime of the factory's own. With `runtime.shared`, the resource ID
  of a shared runtime in another factory, it is a linked runtime:
  `typeProperties.linkedInfo` is `{"authorizationType": "RBAC", "resourceId": <shared>}`.
  A resource ID that differs between environments is a parameter, as any value.
- `runtime_kind: azure`: `{"type": "Managed"}` with
  `typeProperties.computeProperties.location` from `runtime.location` (default
  `AutoResolve`), the region's display name as Data Factory writes it and, when `runtime.data_flow` is set, `dataFlowProperties`
  (`computeType`, `coreCount`, `timeToLive` from `compute_type`, `core_count`,
  `time_to_live`). With `runtime.managed_virtual_network: true`, the runtime
  has `managedVirtualNetwork` `{"type": "ManagedVirtualNetworkReference", "referenceName": "default"}`
  and the folder has `managedVirtualNetwork/default.json`,
  `{"name": "default", "properties": {}}`, which the export needs to keep the
  reference.

`runtime.shared` with `runtime_kind: azure`, an Azure setting with
`runtime_kind: self-hosted`, or any `runtime` with `AutoResolveIntegrationRuntime`
is a method check problem. So is a `runtime.location` in lower-case letters
and digits only, a region's short name: Microsoft's export rewrites it to the
display name where every environment has the same value, but not in a
parameter, so environments would deploy different spellings. A runtime name described in two ways is a pack
check problem.

The pack does not describe an Azure runtime's copy or pipeline compute, or a
self-hosted runtime's description, so a deployment resets them. The platform
request names each runtime, what the deployment does to it, and asks for
`az deployment group what-if` before the first deployment to a factory that
already has runtimes. The same words are a `PACK_NOTICE` for each runtime
except ADF's own Azure runtime, when every environment is generated together:
the message is the request's line for the runtime, and the hint is the
`what-if` check. When the environments describe a runtime in different words (a
linked runtime's resource, a region), there is a notice for each environment,
and its message starts with `In <environment>: `. A notice is a warning, so the
files are still written. The notices are the same for a single
environment given to `buildEnvironments` as one target; the single-target
`build` gives none.

### Which values become parameters

Each target's `build` is compared with the first target's as JSON. A value
becomes a parameter where it differs between targets, or where a target holds
a deploy-time value (definitions specification, section 1.1) as the whole
value:

- a text, number or flag;
- an ADF expression object (`{"value": "@…", "type": "Expression"}`): its
  `value`;
- a list of plain values, as one parameter.

Lists of objects, such as activities, are compared item by item. Everything
else is written as it is.

### The definition file

`arm-template-parameters-definition.json` names the property of each value
that becomes a parameter, under its ARM resource type
(`Microsoft.DataFactory/factories/linkedServices`, `…/datasets`,
`…/pipelines`, `…/triggers`); linked services and datasets are keyed by their
`properties.type` first, such as `AzureBlobFS`. An index into a list is a
one-item array, which the export applies to every item. The action is `-`,
which keeps no default, so a stage that leaves a parameter out fails to deploy
instead of taking the first environment's value; `-::int`, `-::bool` and
`-::array` give numbers, flags and lists their type. An expression object is
named by its key, and the export replaces its `value`. With no value that
differs, the file is `{}`, which still replaces Microsoft's default
parameterisation.

A definition applies to every resource of its type, so a parameter can stand
for a value that is the same in every target. Minimality, in this pack's
terms: the definition names only properties where some resource differs or
takes a deploy-time value. Each parameter file sets every parameter the
template has, except those a target leaves for the deploying pipeline.

### Parameter names

Names are the export's own: the resource's name, then each key down to the
value, joined with `_`, where a key whose value is a list gives way to the
item's index; for example `ls_erp_landing_properties_typeProperties_url`,
`tr_erp_erp_properties_runtimeState` and
`pl_erp_erp_properties_0_typeProperties_0_typeProperties_source_0_value`.
`conformance/arm-parameters.json` has the cases.

### Deploy-time values

A deploy-time value that is a whole value is a parameter that the targets
where it is one leave out of their parameter file; the deploying pipeline
supplies it, as `--parameters <name>=<value>` or the deployment task's
override parameters. `deployValues` lists, for each such value, every
parameter name it is supplied as, in the order the models first hold the
values. An ARM parameter's name comes from where the value is, not from
`NAME`, so a value used in several places is supplied under each name.

### Secure strings the export adds

For some linked service types the export adds a `secureString` parameter with
no default, named `<linked service>_<property>`, for an optional secret the
linked service leaves out; leaving it out, writing `null` or an empty secure
string does not stop it, and a Key Vault reference in its place does. The
pack keeps the list, by type: Informix and MicrosoftAccess `credential`,
SharePointOnlineList `servicePrincipalEmbeddedCertPassword`, SnowflakeV2
`privateKeyPassphrase`, Square `refreshToken`, and Xero `consumerKey` and
`privateKey`. The connection settings `credential` (Informix, Microsoft
Access), `certificate_password` (SharePoint Online List),
`private_key_password` (Snowflake) and `refresh_token` (Square) give these
secrets from Key Vault. Each one still left out is listed in `deployValues`,
with its parameter as its name and in `suppliedAs`, so that the deploying
pipeline supplies it; the platform request names it; a `PACK_NOTICE` names it
when the environments are generated together; and it counts toward the 256
parameters. A parameter file cannot give it as a Key Vault reference, which
needs the vault's resource ID and a secret the project does not name.

The notice has these words, where `<name>` is the parameter, `<type>` the
linked service's type, `<property>` the optional secret and `<linked service>`
the linked service that leaves it out:

| Part    | Words                                                                                                                                                                                   |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Message | ``ARM parameter `<name>`: Microsoft's export adds it, a secure string with no default, for the <type> linked service's optional `<property>`, which `<linked service>` leaves out.``    |
| Hint    | `Supply it when deploying each environment.`                                                                                                                                            |
| Hint    | ``Supply it when deploying each environment, or set the connection's `<setting>` to a Key Vault secret so the export does not add it.``, when a setting gives the secret from Key Vault |

The request's line is the message and the hint together, with a space between.

### What is refused

Before any file is written, in this order:

1. `compareTargets` (definitions specification, section 2.1).
2. `DEPLOY_VALUE` for a landing folder that holds a deploy-time value: ADF
   splits it into the storage account's URL, the file system and the folder.
   Hint: `Write the landing folder in project.yaml for each environment, such as abfss://landing@<account>.dfs.core.windows.net/<folder>.`
3. `DEPLOY_VALUE` for a resource named after a deploy-time value, such as an
   integration runtime, with the hint
   `Write the integration runtime's name in project.yaml for each environment.`
   or, for another resource, `Write the value this resource is named after in project.yaml for each environment.`
4. `ENVIRONMENTS_DIFFER` for integration runtimes whose names or types differ:
   `The integration runtimes are <name> (<type>), … in <target> and … in <target>; Microsoft's CI/CD needs each runtime to have the same name and type in every environment.`
5. `ENVIRONMENTS_DIFFER` for a resource whose name differs, each target
   building as many resources in its folder, paired in the order built:
   `The <kind> is named "<name>" in <target> and "<name>" in <target>.`;
   otherwise for a resource some targets build:
   `The <kind> "<name>" is built in <targets> but not in <targets>; every environment's factory must have the same resources.`
6. `ENVIRONMENTS_DIFFER` for a resource that differs in more than a value: a
   value of another JSON type, an object with other keys, or a list of objects
   of another length:
   `In the <kind> "<name>", <property> of the resource differs between environments in more than a value: it is <value> in <targets> and <value> in <targets>.`
7. `DEPLOY_VALUE` for a deploy-time value inside a longer text, or in a list,
   with the hint
   `Write the value in project.yaml for each environment, as a storage account's or Key Vault's name is; or make the variable hold the whole value, such as the full URL.`;
   and for two deploy-time values at one place.
8. `ARM_PARAMETERS` when the template would have more than 256 parameters,
   `factoryName` and the secure strings the export adds included:
   `The ARM template would have <count> parameters: factoryName, <n> for values that differ between environments and <m> secure strings the export adds. Azure Resource Manager allows 256. The most come from <property> of each <kind> (<count>), …`,
   naming the three properties with the most parameters, with the hint
   `Microsoft suggests three ways: make fewer values differ between environments, such as an audit column that holds the environment's name; give values that are the same in many places one global parameter; or split the definitions into more than one factory.`

Each `ENVIRONMENTS_DIFFER` message from 4 to 6 ends with the method and
connection settings, and table objects, that differ between the targets, up
to three, each with its value in each target:
` Settings that differ: <setting> (<value> in <targets> and <value> in <targets>).`
Value problems are located at `project.yaml`, where values differ between
environments; deploy-time problems at the value's first use.

`SECRET_NAME_DIFFERS` is a warning for a Key Vault secret name
(`secretName` of an `AzureKeyVaultSecret`) that differs: it is a parameter
and deploys, but Microsoft recommends a vault per environment with the same
secret names.

### The fold property

- `render(e)` is `build(models[e])`.
- `view(files, e)` is the factory's resources, out of `factory/`, with each
  parameter the definition makes (by the export's rules above) set from
  `parameters/e.json`, or, where the deploying pipeline supplies it, to the
  deploy-time value's text. A parameter that neither sets keeps the factory's
  value.
- Files are compared as JSON data.

`buildEnvironments` checks the property for every target before it returns,
and reports a file whose view differs as `ENVIRONMENTS_DIFFER`.

The tests check it with `checkFold` on fixtures of one, two and three targets,
where a value is the same in test and prod but differs in dev, and show that
three deliberately wrong folds fail. Independently of this pack's model of
the export, they run Microsoft's export, version 1.0.3, on folded fixtures,
the connector catalogue included: every parameter a parameter file sets or the
pipeline supplies is declared in the exported template and no other; and the template with a target's values deploys the same
resources as that target's own factory exports to. A parameter file with a
renamed parameter, or another environment's value, fails those checks. The
tests run against the build tool Microsoft serves, print its SHA-256, and warn
when it is not one of the builds listed in `test/adf-tool-builds.json`. They are
skipped when no build can be downloaded or run, and fail instead with
`INGESTRON_REQUIRE_ADF_EXPORT=1`, which CI sets.

### Triggers

A trigger is stopped when `paused` says so, else when the platform's
`schedule.paused` does, else unless the environment is `prod` or `production`.
The environment's name decides, not `mode`, which with environments generated
together defaults to `production` for every environment but `dev`. The pack
lists `schedule.paused`, the only Platform setting it reads, as
`platformFields`.
`runtimeState` becomes a parameter where it differs. The post-deployment
script reads a parameterised `runtimeState` from the parameter file it is
given with `-ArmTemplateParameters`, and starts only the triggers whose state
is `Started`.

### Upgrading from adf@1

1. Change the standard to `adf@2`. The CLI then writes `build/adf/` and reports
   each `build/<environment>/adf/` as no longer generated.
2. Resource names are the same as in 1.x, so the first ARM deployment to each
   factory updates its resources in place, and writes each integration
   runtime as the settings describe it. Describe a linked runtime with
   `runtime.shared`, and an Azure runtime's region, data flow compute and
   managed virtual network with `runtime`, then run `az deployment group what-if`
   against each factory before the first deployment.
3. Deploy each factory from one project only: the post-deployment script
   deletes the factory's resources, runtimes included, that the template does
   not hold.
4. Triggers outside `prod` and `production` stay stopped, as in 1.x. A
   platform that set `mode: production` for another environment to start its
   triggers now sets `paused: false` in the ADF methods' settings instead.
5. A landing folder or integration runtime given by `${envvar:…}` is refused
   (`DEPLOY_VALUE`); write it in project.yaml for each environment. A Key
   Vault URL or another whole value may stay `${envvar:…}`; the deploying
   pipeline supplies it under the names `deployValues` gives.
6. Names that differ between environments, such as the 1.x PostgreSQL recipe's
   `_${environment.name}` suffix, are refused. Removing the suffix renames the
   resources: the deployment creates them under the new names and the
   post-deployment script deletes the old ones, with their trigger history.
7. A pipeline that deployed `build/<environment>/adf/` as JSON moves to the
   template: run the export on `build/adf/factory`, then for each stage the
   pre-deployment script, `az deployment group create --mode Incremental`
   with `parameters/<environment>.json` and `factoryName`, and the
   post-deployment script, both scripts given `-ArmTemplateParameters
parameters/<environment>.json`.
8. Output Microsoft's export refused in 1.x changes:
   - MongoDB, MongoDB Atlas and Azure Cosmos DB for MongoDB datasets write
     `collection`.
   - Microsoft 365 lands through a binary copy into `<object>/`, in files
     Microsoft names, so its tables use `layout: increments`; a `snapshot`
     or `path` table sets it. Before the first 2.0 run, delete or move the
     1.x file, `<object>/<object>.json` (or the files a `path` wrote),
     because it matches the new location, `<object>/*.json`, and a store
     reading the folder would load it again. Point readers of the old file
     at `<object>/*.json`. A table without a date filter adds a whole
     extract on each run, so its readers take only the latest run's files.
   - A `UserAssignedManagedIdentity` connection needs `identity`, the
     identity's resource ID; the factory gets the credential, and the
     platform request asks for the identity to be assigned to the factory.
     A credential of the same name created in Studio is replaced by the
     template's.
   - Resource names are at most 140 characters and Copy activity names 55;
     a longer default name is refused with the `resource_names` role to
     set. A renamed resource is recreated under its new name and the
     post-deployment script deletes the old one, as for the PostgreSQL
     recipe; a renamed tumbling-window trigger re-runs its past windows
     from `start`.
   - `runtime.location` takes the region's display name, as Data Factory
     shows it, such as `UK South`, not its short name, such as `uksouth`.

### Known limits of Microsoft's export

Found by running it on the connector catalogue (2026-11-04 and 2026-11-05).
Every connector in the catalogue now exports; the tests run the whole
catalogue through it with no exceptions.

- Its validator, not the connector pages, decides some shapes: the MongoDB
  family's `collection`, Microsoft 365's binary folder sink, and the
  credential a `UserAssignedManagedIdentity` linked service references, which
  the pack writes. Its name limits (140 or 141 characters, 55 for an activity)
  are the pack's.
- For some connectors it adds secure string parameters of its own (see
  "Secure strings the export adds").

# Source query layout

Generated SQL Server-family Copy queries use SELECT on its own line, one
indented projected column per line, FROM on its own line, and, for incremental
queries, WHERE and AND on separate lines. Quoting, expression substitutions
and window predicates retain their existing semantics. The multiline string
is JSON-escaped when embedded in a pipeline resource.
