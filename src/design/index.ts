// The design module: what the rest of the package uses.
export {
  afterCopyOf,
  afterCopySchema,
  checkingAfterCopy,
  timeoutSeconds,
} from "./after-copy-settings.js";
export { afterCopy } from "./after-copy.js";
export {
  defaultParallel,
  designPlacement,
  designSettings,
  fileDesignSettings,
} from "./design-settings.js";
export { intentAuditColumns } from "./intent-audit.js";
export {
  activity,
  additionalColumnsOf,
  annotationsOf,
  auditMappings,
  decorate,
  describeCopy,
  describePipeline,
  policyOf,
  withOperations,
} from "./design.js";
export { filesOutput, layoutProblems, samePathProblems, tableOutput } from "./landing-output.js";
export { parseLanding } from "./landing.js";
export { datedPath, landedFile, layoutOf, staticFile } from "./layout.js";
export {
  concatenated,
  filterSegments,
  literal,
  plainValue,
  renderFilter,
  stamp,
} from "./filter.js";
export { isIncremental, query, selectOf, setsLoad, watermarkOf } from "./query.js";
export { sqlTypes } from "./sql-types.js";
