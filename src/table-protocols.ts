// Protocol sources that return tables through native ADF datasets.
import { webFields } from "./web-auth.js";
import { databaseFields, textField as text, type TableSource } from "./table-source.js";

/** Native ODBC and OData sources, with explicit basic authentication. */
export const tableProtocols: TableSource[] = [
  {
    id: "rest",
    title: "REST",
    docs: "rest",
    service: "RestService",
    dataset: "RestResource",
    source: "RestSource",
    object: ["relativeUrl"],
    fields: webFields,
    defaults: { authenticationType: "Anonymous", enableServerCertificateValidation: true },
    hierarchical: true,
  },
  {
    id: "odbc",
    title: "ODBC",
    docs: "odbc",
    service: "Odbc",
    dataset: "OdbcTable",
    source: "OdbcSource",
    object: ["tableName"],
    fields: {
      connection_string: text(
        "connectionString",
        "ODBC connection string without credentials, such as DSN=warehouse.",
      ),
      user: { ...databaseFields.user, native: "userName" },
      password: databaseFields.password,
    },
    defaults: { authenticationType: "Basic" },
    query: true,
    runtime: "self-hosted",
  },
  {
    id: "odata",
    title: "OData",
    docs: "odata",
    service: "OData",
    dataset: "ODataResource",
    source: "ODataSource",
    object: ["path"],
    fields: {
      url: text("url", "OData service root URL."),
      user: { ...databaseFields.user, native: "userName" },
      password: databaseFields.password,
    },
    defaults: { authenticationType: "Basic" },
    query: true,
  },
];
