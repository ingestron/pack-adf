// Native SQL Server family types from Microsoft Learn, accessed 2026-10-28.

/** Native resource types and documentation for each SQL Server family source. */
export const sqlTypes: Record<
  string,
  {
    title: string;
    service: string;
    dataset: string;
    source: string;
    docs: string;
  }
> = {
  sqlserver: {
    title: "SQL Server",
    service: "SqlServer",
    dataset: "SqlServerTable",
    source: "SqlSource",
    docs: "sql-server",
  },
  "azure-sql-database": {
    title: "Azure SQL Database",
    service: "AzureSqlDatabase",
    dataset: "AzureSqlTable",
    source: "AzureSqlSource",
    docs: "azure-sql-database",
  },
  "azure-sql-managed-instance": {
    title: "Azure SQL Managed Instance",
    service: "AzureSqlMI",
    dataset: "AzureSqlMITable",
    source: "SqlMISource",
    docs: "azure-sql-managed-instance",
  },
  "azure-synapse": {
    title: "Azure Synapse Analytics",
    service: "AzureSqlDW",
    dataset: "AzureSqlDWTable",
    source: "SqlDWSource",
    docs: "azure-sql-data-warehouse",
  },
  "amazon-rds-sqlserver": {
    title: "Amazon RDS for SQL Server",
    service: "AmazonRdsForSqlServer",
    dataset: "AmazonRdsForSqlServerTable",
    source: "AmazonRdsForSqlServerSource",
    docs: "amazon-rds-for-sql-server",
  },
};
