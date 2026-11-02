// What the ADF pack tells the packs that read its files, beyond StepOutput:
// the columns the files carry that the contract does not list.
import type { Column, StepOutput } from "@ingestron/definitions";

/** A step's output with the audit columns its files carry, in order (definitions 1.6 adds this to StepOutput). */
export interface LandedOutput extends StepOutput {
  columns?: Column[];
}
