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

## One factory for every environment

Accessed 2026-11-04, against current Microsoft documentation:

- [Custom parameters in a Resource Manager template](https://learn.microsoft.com/en-us/azure/data-factory/continuous-integration-delivery-resource-manager-custom-parameters)
  (updated 2026-08-05): the file is `arm-template-parameters-definition.json`
  in the root folder, "You must use that exact file name"; "If no file is
  found, the default template is used", which the page reproduces. The syntax
  is `<action>:<name>:<stype>`: `=` keeps the current value as the default,
  `-` does not keep a default, `|` is for Key Vault secrets; a blank name
  takes the property's, one starting with `-` is shortened to
  `<resource>_<name>`; types are `string` (the default), `securestring`,
  `int`, `bool`, `object`, `secureobject` and `array`. `*` parameterises the
  properties one level below it. "Specifying an array in the definition file
  indicates that the matching property in the template is an array", and the
  definition applies to every item. "A definition can't be specific to a
  resource instance." Linked services and datasets take a section per type.
  "By default, all secure strings … are parameterized." The custom file
  "doesn't change the ARM template parameter limit of 256".
- [Template limits](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/best-practices#template-limits)
  (updated 2026-06-26): 256 parameters, 800 resources, 4 MB per template.
  Neither that page nor
  [Parameters in templates](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/parameters)
  (updated 2026-06-26) states a limit on a parameter name's length; the export
  wrote a 170-character name without shortening it.
- [Continuous integration and delivery](https://learn.microsoft.com/en-us/azure/data-factory/continuous-integration-delivery)
  (2026-07-29): "Data Factory expects you to have the same name, type, and
  subtype of integration runtime across all stages of CI/CD"; keep a Key Vault
  per environment with "the same secret names across all stages", so "the
  only thing that changes is the key vault name"; unrelated files in the
  repository's data folder "could cause resource loading errors"; only the
  development factory is associated with Git.
- [Automated publishing](https://learn.microsoft.com/en-us/azure/data-factory/continuous-integration-delivery-improvements)
  (2026-07-29): `npm run build export <rootFolder> <factoryId> [outputFolder]`
  validates, then writes the ARM template; the artefacts include the pre- and
  post-deployment scripts. The `adf_publish` branch stays supported.
- [Pre- and post-deployment scripts](https://learn.microsoft.com/en-us/azure/data-factory/continuous-integration-delivery-sample-script)
  (2025-01-29), and the script itself,
  [PrePostDeploymentScript.Ver2.ps1 at 507f4d4](https://github.com/Azure/Azure-DataFactory/blob/507f4d4a53da29edc684d934161aa880befd3e0c/SamplesV2/ContinuousIntegrationAndDelivery/PrePostDeploymentScript.Ver2.ps1)
  (2024-07-11), the same as the `PrePostDeploymentScript.ps1` the export
  writes apart from comments and the preview's trigger comparison: after
  deployment it deletes every trigger, pipeline, data flow, dataset, linked
  service and integration runtime that is not in the template; it reads
  parameter values from `-ArmTemplateParameters` (by default
  `ARMTemplateParametersForFactory.json` beside the template), substitutes a
  parameterised `runtimeState`, and starts the triggers whose state is
  `Started`.
- [`@microsoft/azure-data-factory-utilities` 1.0.3](https://www.npmjs.com/package/@microsoft/azure-data-factory-utilities)
  (MIT, published 2025-09-17): its `lib/bundle.manager.js` downloads the
  build tool from `https://adf.azure.com/assets/cmd-api/main.js` on each run,
  unless `--path` names a copy; the URL is not versioned, and Microsoft serves
  different builds at it: on 2026-11-04 and 2026-11-05 a maintainer's
  computer got SHA-256
  `9c7cb2722b4dc516b5e906c7efd1672f24b6849a5492a42a92b63c602fbb76aa`
  (17000605 bytes, ETag `"0878b12cb62dd1:0"`, Last-Modified 23 Oct 2026),
  while a GitHub Actions runner got
  `3329ccd91c23748ba0dae0863dace9835076b57bc6e4f4601cbb959b266b366f` on
  2026-11-05. `test/adf-tool-builds.json` lists the builds seen.

Experiments with that package and tool, on synthetic factories, 2026-11-04:

- Parameter names: the resource's name, then the keys down to the value,
  where an array's key gives way to the item's index:
  `pl_erp_every_24_hour_properties_3_typeProperties_1_typeProperties_url`
  for `activities[3].typeProperties.activities[1].typeProperties.url`. A whole
  list made a parameter loses its own key (`…_typeProperties_source` for
  `source.additionalColumns`, `…_properties_parameters_tables` for
  `parameters.tables.defaultValue`).
- `-` on an expression object puts the parameter in its `value` and keeps
  `type: Expression`; the name has no `_value`.
- With `-` the parameter has no `defaultValue`; with `=` it has one.
- An empty definition, `{}`, gives a template whose only parameter is
  `factoryName`; with no file, the default parameterisation applies.
- A `connectVia` to an integration runtime that is not in the folder is
  dropped from the exported linked service, with "reference is empty" in the
  log, and validation still passes. With `integrationRuntime/<name>.json`
  present, it is kept and the runtime is a resource of the template. A
  `connectVia` to `AutoResolveIntegrationRuntime` is dropped either way, which
  is ADF's default.
- The export adds `annotations: []` and defaults such as an activity's
  `headers: {}`, so the tests compare the folded factory's export with each
  environment's own factory's export, not with the Git JSON.
- A linked service with a credential that is not in the folder fails
  validation, and so does a linked service name over 141 characters ("It
  should be in the form `/^[^-\s][^\\/:*?"<>|]{1,140}$/`", a first character
  then up to 140). Both are fixed since; see "Output Microsoft's export
  refused".

## Integration runtimes and the export's secure strings

Accessed 2026-11-04:

- [Deployment modes](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deployment-modes)
  (updated 2026-06-26): "When redeploying an existing resource in incremental
  mode, all properties are reapplied. The properties aren't incrementally
  added. … Properties that aren't included in the template are reset to the
  default values. Specify all non-default values for the resource, not just
  the ones you're updating." This is why each runtime is written as the
  settings describe it, and why the request asks for `az deployment group what-if`.
- [Microsoft.DataFactory/factories/integrationRuntimes](https://learn.microsoft.com/en-us/azure/templates/microsoft.datafactory/factories/integrationruntimes)
  (updated 2026-10-20): the name's "Min length = 3 Max length = 63 Pattern =
  `^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$`"; a self-hosted runtime's `linkedInfo`
  with `authorizationType` `RBAC` and `resourceId`, "The resource identifier of
  the integration runtime to be shared"; a managed runtime's
  `managedVirtualNetwork` (`ManagedVirtualNetworkReference`) and
  `computeProperties` (`location`, `dataFlowProperties` with `computeType`
  `ComputeOptimized`, `General` or `MemoryOptimized`, `coreCount` "8, 16, 32,
  48, 80, 144 and 272", and `timeToLive` in minutes, at least 0).
- [Integration runtime performance](https://learn.microsoft.com/en-us/azure/data-factory/concepts-integration-runtime-performance)
  (updated 2025-03-31; cited 2026-11-05): a data flow runs on a Spark cluster
  defined by the runtime; "The default cluster size is four driver cores and
  four worker cores (small)", and the sizes 8, 16, 32, 48, 80, 144 and 272 are
  total cores (driver and worker). Its table gives worker and driver cores as
  4 and 4 (small), 8 and 8 (medium), 16 and 16 (large), 32 and 16, 64 and 16,
  128 and 16, and 256 and 16. "Time to live isn't available when using the
  auto-resolve integration runtime (default)." It describes no compute type,
  so the `compute_type` descriptions say only what the ARM reference above and
  the next entry show: `ComputeOptimized` is a value ADF accepts and nothing
  more.
- [Troubleshoot mapping data flows](https://learn.microsoft.com/en-us/azure/data-factory/data-flow-troubleshoot-guide)
  (ms.date 2025-06-03; cited 2026-11-05): for out-of-memory errors, "Use an
  integration runtime with more cores and/or the memory optimized compute
  type."
- [Microsoft.DataFactory/factories/managedVirtualNetworks](https://learn.microsoft.com/en-us/azure/templates/microsoft.datafactory/factories/managedvirtualnetworks)
  (updated 2026-10-20; cited 2026-11-05): `name` is required, 1 to 127
  characters, `^([_A-Za-z0-9]|([_A-Za-z0-9][-_A-Za-z0-9]{0,125}[_A-Za-z0-9]))$`,
  which `default` meets; `properties` is required, and its
  `ManagedVirtualNetwork` type has no named properties, so the pack writes
  `{"name": "default", "properties": {}}`.
- [Managed virtual network and managed private endpoints](https://learn.microsoft.com/en-us/azure/data-factory/managed-virtual-network-private-endpoint)
  (2026-07-29): "An existing global integration runtime can't switch to an
  integration runtime in a Data Factory managed virtual network and vice
  versa"; its PowerShell example creates `managedVirtualNetworks/default` with
  empty properties and a runtime with
  `managedVirtualNetwork = @{ type = "ManagedVirtualNetworkReference"; referenceName = "default" }`.
- [Troubleshoot CI-CD](https://learn.microsoft.com/en-us/azure/data-factory/ci-cd-github-troubleshoot-guide)
  (updated 2026-08-05): `DataFactoryPropertyUpdateNotSupported: Updating
property type is not supported` "is due to an integration runtime with the
  same name in the target service instance, but with a different type"; and
  "Parameterizing an entity reference (Integration runtime in Linked service,
  …) isn't supported", which is why runtime names that differ are refused. A
  linked runtime's `resourceId` is a property, not a reference, so it may be a
  parameter; Microsoft's default parameterisation makes it one.

Experiments with the export (`main.js` SHA-256 `9c7cb272…fbb76aa`), 2026-11-04:

- A linked runtime written with `"authorizationType": "RBAC"` exports with its
  `linkedInfo`, the type written `Rbac`; with `linkedInfo.resourceId` in the
  definition it is the parameter
  `<runtime>_properties_typeProperties_linkedInfo_resourceId`.
- A managed runtime with `managedVirtualNetwork` keeps the reference, and the
  template holds a `Microsoft.DataFactory/factories/managedVirtualNetworks`
  resource, only when `managedVirtualNetwork/default.json` is in the folder;
  without it the reference is dropped.
- A managed runtime without `dataFlowProperties` exports with
  `{"computeType": "General", "coreCount": 8, "timeToLive": 0}`.
- `integration_runtime: shir_erp` fails validation: "Integration runtime name
  cannot be 'shir_erp'".
- For Square's `refreshToken`, Informix's `credential`, Snowflake's
  `privateKeyPassphrase` and Xero's `consumerKey` and `privateKey`, the export
  adds a `secureString` parameter with no default whether the property is left
  out, `null`, or `{"type": "SecureString", "value": ""}`; with an
  `AzureKeyVaultSecret` in its place it adds none. Each is described
  "Secure string for '<property>' of '<linked service>'".

The tests run against the build the URL serves, as the package's users do,
cached under its SHA-256 and downloaded again when a cached file does not match
its key. They print the hash in use, and warn (a GitHub Actions `::warning::`
annotation in CI) when it is not in `test/adf-tool-builds.json`, so that a
maintainer checks the results and adds it.

## Output Microsoft's export refused

Accessed 2026-11-05. Where a Microsoft Learn page and the export's validator
disagree, the pack follows the validator, which is what users run.

- MongoDB collections. The connector pages for
  [MongoDB](https://learn.microsoft.com/en-us/azure/data-factory/connector-mongodb)
  (2026-08-06),
  [MongoDB Atlas](https://learn.microsoft.com/en-us/azure/data-factory/connector-mongodb-atlas)
  (2025-12-25) and
  [Azure Cosmos DB for MongoDB](https://learn.microsoft.com/en-us/azure/data-factory/connector-azure-cosmos-db-mongodb-api)
  (2025-12-25) give the dataset's `collectionName`, "Name of the collection in
  MongoDB database. Required: Yes". The
  [dataset resource reference](https://learn.microsoft.com/en-us/azure/templates/microsoft.datafactory/factories/datasets)
  (updated 2026-10-20) gives `collection`, required, for
  `MongoDbV2CollectionDatasetTypeProperties`,
  `MongoDbAtlasCollectionDatasetTypeProperties` and
  `CosmosDbMongoDbApiCollectionDatasetTypeProperties`. The export refuses
  `collectionName` ("Collection name is required"); its build tool reads the
  collection as `collection` for these three datasets, and as `collectionName`
  for Cosmos DB for NoSQL, which the reference agrees with. **Disagreement:**
  the connector pages are wrong for these three; the pack writes `collection`.
- Microsoft 365. The
  [connector page](https://learn.microsoft.com/en-us/azure/data-factory/connector-office-365)
  (2025-04-27, updated 2026-08-05) says a copy can "only ingest data from
  Microsoft 365 (Office 365) into Azure Blob Storage, Azure Data Lake Storage
  Gen1, and Azure Data Lake Storage Gen2 in JSON format (type setOfObjects)".
  The export refuses a JSON sink dataset: "Microsoft 365 source only supports
  copying to binary format dataset. Please select binary format for sink
  dataset." With a `Binary` dataset it refuses a file name: "Microsoft 365
  source only supports copying to a folder." A `BinarySink` into a binary
  dataset of a folder exports, keeping the source's `outputColumns` and date
  filter. Graph Data Connect's
  [sinks](https://learn.microsoft.com/en-us/graph/data-connect-datasets#sinks)
  (2024-11-07, updated 2025-08-06): "For copy activity, the output files are
  formatted as JSON. This format is fixed and modifying the format isn't
  supported." The file names are not documented; a Microsoft Tech Community
  post, [MGDC for SharePoint FAQ: What counts as an object?](https://techcommunity.microsoft.com/t5/microsoft-graph-data-connect-for/mgdc-for-sharepoint-faq-what-counts-as-an-object/ba-p/4074274)
  (2024-03-04), says the files have "a JSON file extension", with "one line per
  object", and that many objects are packed "as multiple “json” files". So the
  pack reports `<object>/*.json` in the format `json`. **Disagreements:** the
  connector page's JSON sink; and the
  [Binary format page](https://learn.microsoft.com/en-us/azure/data-factory/format-binary)
  (2025-03-31, updated 2026-08-05): "When using Binary dataset in copy activity,
  you can only copy from Binary dataset to Binary dataset", which an
  `Office365Source` into a binary sink contradicts. The pack follows the
  validator in both; whether the copy runs can be checked only against a live
  tenant.
- User-assigned managed identities.
  [Credentials](https://learn.microsoft.com/en-us/azure/data-factory/credentials)
  (2024-09-26, updated 2026-08-05): associate the identity with the factory,
  then create a credential for it; "Users must have the Managed Identity
  Operator (Azure RBAC) role … to configure a user assigned managed identity as
  a credential". The
  [credential resource reference](https://learn.microsoft.com/en-us/azure/templates/microsoft.datafactory/factories/credentials)
  (updated 2026-07-20): `type` `ManagedIdentity` with
  `typeProperties.resourceId`, "The resource id of user assigned managed
  identity"; the name 1 to 127 characters,
  `^([_A-Za-z0-9]|([_A-Za-z0-9][-_A-Za-z0-9]{0,125}[_A-Za-z0-9]))$`. The
  export reads `credential/<name>.json`; with it, the linked service exports
  with its `CredentialReference`, the template holds a
  `Microsoft.DataFactory/factories/credentials` resource, and with
  `properties.typeProperties.resourceId` under that type in the definition the
  identity is the parameter `<credential>_properties_typeProperties_resourceId`.
- Names. [Naming rules](https://learn.microsoft.com/en-us/azure/data-factory/naming-rules)
  (2025-03-31, updated 2026-08-05) give no length for linked services,
  datasets, pipelines or triggers. The export refuses a linked service or
  trigger name over 141 characters (pattern
  `^[^-\s][^\\/:*?"<>|]{1,140}$`), a dataset or pipeline name over 140
  ("factoryEntityNameLengthValidator", `^.{1,140}$`) and an activity name over
  55 (`^.{1,55}$`); 140, 140 and 55 export.
  [Pipelines and activities](https://learn.microsoft.com/en-us/azure/data-factory/concepts-pipelines-activities)
  (2026-06-17, updated 2026-08-04) agrees for pipelines and activities: a
  pipeline's name has "Maximum number of characters: 140", and an activity's
  "Maximum number of characters: 55". The pack keeps every resource to 140 and
  an activity to 55.
- Regions. The export rewrites a managed runtime's `location` given as a
  short name, such as `uksouth`, to its display name, but leaves a parameter's
  value as given, so a fold whose environments differ in region deployed
  `uksouth` where the environment's own export had the display name. The pack
  refuses the short name.

Experiments with the export (`main.js` SHA-256 `9c7cb272…fbb76aa`), 2026-11-05,
on the connector catalogue and on hand-written factories for each case above;
the tests now run every case through it.

## Where to find a value (`find`)

Accessed 2026-11-05. A new project's README.md shows these beside each value
`ingestron init` writes as `REPLACE_ME`:

- [Create a self-hosted integration runtime](https://learn.microsoft.com/en-us/azure/data-factory/create-self-hosted-integration-runtime):
  in the Data Factory UI, the Manage tab, then Integration runtimes.
- [Set and retrieve a secret from Key Vault using the Azure portal](https://learn.microsoft.com/en-us/azure/key-vault/secrets/quick-create-portal):
  a vault's secrets are under Objects, Secrets, and Generate/Import adds one.
- [Upload, download and list blobs with the Azure portal](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-quickstart-blobs-portal):
  a storage account's containers are under Data storage, Containers.

A database's server, database and login come from its own administrator, so
their `find` says so rather than naming a vendor's tool. `default` is not set
on any setting yet: the [Hive connector](https://learn.microsoft.com/en-us/azure/data-factory/connector-hive)
documents no default port, and the pack does not choose one for the owner.

## Hive authentication

Accessed 2026-11-05:

- [Copy data from Hive](https://learn.microsoft.com/en-us/azure/data-factory/connector-hive)
  (version 2.0 change log): "SASL transport protocol only supports
  UsernameAndPassword authentication type. Binary transport protocol only
  supports Anonymous authentication type." So a Hive connection with
  `transport: Binary` writes `authenticationType: Anonymous` and takes no
  `user` or `password`; `SASL` and `HTTP` write `UsernameAndPassword` and need
  both.
- [Setting up HiveServer2](https://cwiki.apache.org/confluence/display/Hive/Setting+Up+HiveServer2):
  `hive.server2.thrift.port` defaults to 10000 for Binary transport, and
  `hive.server2.thrift.http.port` to 10001 for HTTP. The catalogue's example
  uses 10000.
