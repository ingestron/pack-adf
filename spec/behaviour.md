# Azure Data Factory generation

The ADF pack reads the Connection, Flow, Platform and Standard settings. The pack builds native resources; it does not provision shared
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
  start) and `{run}` (the run id). It must not start with `/`, have an empty
  folder name, use `.` or `..` as a folder, have a brace outside a `{token}`,
  or have a folder or file name that ADF reads as an expression (starting with
  `@`, or holding `@{`). Each problem is a method check problem.

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

An audit column (`audit_columns`) names the value it holds. A value that is
`run.` or `source.` followed by one of the names the pack lists is matched in
any case (`RUN.ID` and `run.id` are the same) and is generated in its canonical
lower-case form: the ADF expression or literal for that name, with the column's
type. Any other text is landed as written. Text that starts with `run.` or
`source.` in any case but is not one of those names is a method check problem,
as is text that starts with `@` or holds `@{`, which ADF would read as an
expression.

Under `pattern: foreach`, a path with date or run tokens is a method check
problem. It is refused only when the path is the layout in use: if a `layout`
is set closer to the table than the `path` (in the flow, for example), the
layout wins, the path is not used, and the table is not refused. A path with
only `{object}` and `{connection}` is not refused by this rule.

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
already has runtimes. The definitions interface has no warning code for this,
so it is in the request only.

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
pipeline supplies it; the platform request names it; and it counts toward the
256 parameters. A parameter file cannot give it as a Key Vault reference,
which needs the vault's resource ID and a secret the project does not name.

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
   `Make the variable hold the whole value, such as the full URL, or write the value in project.yaml for each environment.`;
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
together defaults to `production` for every environment but `dev`.
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
8. Output Microsoft's export refused in 1.x changes: MongoDB datasets write
   `collection`; Microsoft 365 lands through a binary copy into a folder, so a
   Microsoft 365 table with `layout: snapshot` or a `path` sets `layout:
increments`; a `UserAssignedManagedIdentity` connection adds `identity`, the
   identity's resource ID, and the factory gets the credential; a resource name
   over 140 characters, or a Copy activity name over 55, is shortened with
   `resource_names`; a `runtime.location` short name becomes its display name.

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
