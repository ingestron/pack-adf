// The resources module: what the rest of the package uses.
export { exportResources } from "./export-resources.js";
export {
  fileServerService,
  filesPipeline,
  landingFilesDataset,
  shareDataset,
  type FilesGroup,
} from "./files-resources.js";
export { foreachPipeline } from "./foreach.js";
export { nativeFileConnectors } from "./native-file-resources.js";
export {
  copyPipeline,
  keyVaultService,
  landingDataset,
  landingService,
  reference,
  sourceDataset,
  sqlServerService,
  windowTrigger,
  type CopyGroup,
  type Shared,
} from "./resources.js";
export { nativeSource, stagingOptions, tableTranslator } from "./table-copy-options.js";
