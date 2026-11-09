// The connection module: what the rest of the package uses.
export { connectionProblems } from "./connection-check.js";
export { fileStores } from "./file-sources.js";
export {
  identityExample,
  isSecret,
  nativeValue,
  nonEmpty,
  sqlAuthentication,
  sqlConnectionProblems,
  sqlCredentials,
  vaultSecret,
} from "./sql-auth.js";
export {
  databaseFields,
  finds,
  portField,
  secretField,
  textField,
  type TableSource,
} from "./table-source.js";
export { transportAuthentication, transportProblems } from "./transport-auth.js";
export { needsVault } from "./vault.js";
export { webFields } from "./web-auth.js";
export { httpOptionProblems, webRequestProblems, webRequestSettings } from "./web-options.js";
