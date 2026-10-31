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
