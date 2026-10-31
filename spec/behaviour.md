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
