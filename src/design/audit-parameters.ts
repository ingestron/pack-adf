// `run.parameters.<name>`: an audit value that holds one of the pipeline's parameters.
import type { AuditValue } from "./design-settings.js";

const parameterValue = /^run\.parameters\.([A-Za-z0-9_]+)$/i;

/** The audit value for `run.parameters.<name>` in any case of `run.parameters`; undefined for other text. */
export function parameterAuditOf(written: string): AuditValue | undefined {
  const name = parameterValue.exec(written)?.[1];
  if (name === undefined) return undefined;
  return {
    value: () => `@pipeline().parameters.${name}`,
    expression: true,
    type: "string",
    description: `the run's ${name} parameter`,
  };
}

/**
 * The problems of one audit column's value: `run.` or `source.` text that is not a value the pack
 * lists (`names`, lower case), a parameter the flow does not have, or text ADF reads as an expression.
 */
export function valueProblems(
  column: string,
  value: string,
  names: string[],
  parameters: string[],
): string[] {
  const parameter = parameterValue.exec(value)?.[1];
  if (parameter !== undefined)
    return parameters.includes(parameter)
      ? []
      : [`audit column "${column}" uses "${value}", which names no parameter of the flow`];
  if (/^(run|source)\./i.test(value) && !names.includes(value.toLowerCase())) {
    const known = [...names, "run.parameters.<name>"].join(", ");
    return [`audit column "${column}" uses "${value}"; run and source values: ${known}`];
  }
  if (value.startsWith("@") || value.includes("@{"))
    return [`audit column "${column}" holds "${value}", which ADF reads as an expression`];
  return [];
}
