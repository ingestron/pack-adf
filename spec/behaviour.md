# Azure Data Factory generation

The ADF pack uses the existing Connection, Flow, Platform and Standard
settings. The pack builds native resources; it does not provision shared
infrastructure. Every required user-specific ADF value must be supplied by a
definition or a documented default, including conditional authentication
fields. No generated resource requires a manual configuration edit.

## SQL Server family

`adf-copy` reads `sqlserver`, `azure-sql-database`,
`azure-sql-managed-instance`, `azure-synapse` and `amazon-rds-sqlserver`.
The flow object is `database.schema.table`, with three non-empty parts.
The pack selects contract columns and renames physical source columns using
SQL Server quoting. Incremental mode uses the existing half-open window.

Connection settings include `server`, and `authentication` (default `SQL`).
SQL and Windows authentication require `user` and a secret-reference
`password`. Windows is supported only by SQL Server and Amazon RDS for SQL
Server. Azure SQL Database, Managed Instance and Synapse additionally accept
`ServicePrincipal` (requiring `tenant`, `client_id`, `client_secret`),
`SystemAssignedManagedIdentity`, and `UserAssignedManagedIdentity` (requiring
`credential`, the name of an existing ADF credential resource).
Unknown settings, unsupported authentication modes, empty values and literal
credentials must fail validation before building files. Authentication fields
that do not belong to the selected mode must also fail, avoiding ignored
credentials. The connection contains no credential values, only references.

`integration_runtime` names the existing Azure or self-hosted runtime. Windows
authentication requires a self-hosted runtime as an external prerequisite.
The existing `encrypt` setting and mandatory certificate verification are
preserved. Optional `host_name_in_certificate` sets the expected TLS host.
The existing SQL Server output is unchanged when these additions are unused.

The current resource grouping, landing folder, schedule, standards precedence
and fixed settings apply. Two different sources must not share a landing
folder accidentally: conflicting destinations fail with a message directing
the user to choose a distinct landing path in the definitions.

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
snapshot silently. Copy column mappings preserve contract column names.
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
zero-based table index. Hierarchical sources use JSON paths for contract columns,
with an optional collection reference for REST arrays. PostgreSQL and Greenplum
fix SSL verification to the vendor's numeric value 5. Ports remain configurable.
Snowflake and Databricks Delta exports require an Azure Blob SAS staging secret
and a relative staging path; their linked service is generated from definitions.
Restricted connectors require the matching declared runtime kind. Microsoft 365
requires JSON landing and application authentication for both source and landing;
its date-filter requirement is explicitly declared and uses the trigger window.
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

All three ADF methods accept `resource_names` in the existing method settings.
Each value is a literal name after the existing `${project.id}`,
`${environment.name}` and `${values.…}` references resolve. No new template
syntax or naming layer is introduced. Omitted fields retain the current
project/connection/database/table-derived names byte for byte.

The configurable roles are Key Vault and landing linked services, Parquet,
binary and HTTP landing datasets, source linked service and dataset, pipeline,
trigger, staging linked service, Microsoft 365 JSON linked service and dataset,
and Copy activity. Factory, runtime and credential resources are not generated;
existing runtime and credential references remain their current settings.

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
hyphens. Names are limited to 200 characters to keep generated resource filenames
portable. Invalid names, unknown name roles,
case-insensitive resource collisions and duplicate activities fail before
writing. No sanitisation silently changes a supplied name. Renaming uses the
existing generated manifest to create new paths and remove owned obsolete paths.

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
Existing flows supplying a vault retain their generated service. Other methods'
vault requirements are unchanged. Managed-identity Blob/ADLS file copying needs
only the existing factory identity and storage permissions.

For native `adf-files` sources, `runtime_kind: azure` with
`integration_runtime: AutoResolveIntegrationRuntime` selects ADF's implicit default
Azure runtime: omit `connectVia`. Other named runtimes keep an explicit
`IntegrationRuntimeReference`. File System and HDFS still require self-hosted
runtime validation. See `conformance/default-file-runtime.json`.

## Landing layouts

`adf-copy` and `adf-table` take `layout` (`snapshot` or `increments`) or a
`path` pattern, both placed in the standard; setting both is a method check
problem. Without either, a table that ends at the landed files (`store: none`)
uses `snapshot`, and any other table `increments`; a table whose runs each hold
only their window (`mode: incremental`, or a `source_options.date_filter_column`)
always defaults to `increments`.

- `snapshot` writes `<landing>/<object>/<object>.parquet` (`.json` for
  Microsoft 365), replaced by each run.
- `increments` writes `<landing>/<object>/<windowStart yyyyMMddHHmmss>_<run id>.parquet`;
  for Microsoft 365, ADF names the files in `<landing>/<object>/`.
- A `path` pattern is relative to the landing folder, includes `{object}`,
  ends in a file name with the format's extension, and uses only the tokens `{object}`, `{connection}`,
  `{yyyy}`, `{MM}`, `{dd}`, `{HH}` (the window's start) and `{run}` (the run
  id). Otherwise each problem is a method check problem.

Each copy writes one file (no `maxRowsPerFile`). Each method reports its output:
the file, or a wildcard pattern with one `*` for each run of date or run tokens
(`<object>/*.parquet` for increments); the format; and `add` when each run
writes its own file, else `replace`. A path writes its own file per run when it
has `{run}`, or the date tokens down to the window's unit: `{yyyy}`, `{MM}`,
`{dd}`, `{HH}` for `Hour`; `{yyyy}`, `{MM}` for `Month`; only `{run}` for
`Minute`. `adf-files` reports `<landing>/<object>/**`
with `add` when its `format` is `csv`, `parquet` or `json`, and no output
otherwise.

A table whose runs each hold only their window, with a layout that replaces
one file and no store step, is a method check problem: the next run would
overwrite the rows before anything merged them. A table with a path pattern
whose files land where another tabular table's files land is a pack check
problem; tables with the default layouts are checked by their
`<landing>/<object>/` folders, as before.

Microsoft 365's JSON dataset is shared by a connection's tables: it takes a file
name only when one of them names its file, and then every table passes one
(increments pass the increment name ADF otherwise generates).

## Starting a job after the copies

`after_copy` is a platform setting of every ADF method: `job`, the resource ID
of an Azure Container Apps job,
`/subscriptions/<id>/resourceGroups/<group>/providers/Microsoft.App/jobs/<name>`,
and `timeout`, how long ADF waits for the job's run, as `[d.]hh:mm:ss`
(default `01:00:00`). A `job` that is not such a resource ID is a method check
error. Every ADF table must use the same `after_copy`, or none.

With `after_copy`, the connection pipelines have no triggers. Each group of
triggers with the same window settings and state becomes one parent pipeline,
`pl_<project>_every_<interval>_<frequency, lower case>` (`_2`, `_3` when two
groups share a name), and one trigger, `tr_` with the same name, passing the
window to the parent. The parent:

1. runs each connection pipeline (`run_<pipeline>`, ExecutePipeline, waiting,
   passing the window), with no order between them;
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

The parent trigger's retry count is 0; its retries and interval move onto the
connection pipelines' Copy activities' `policy`. `request` also says to set
`start` to the next window when `after_copy` is turned on.

`request` adds the factory's role on the job, and the job's replica timeout
(half of `timeout`, in seconds) and retry limit (1).
