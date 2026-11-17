// Shared setup for the path-token tests: flow `b` with parameters, a trigger, and a path.
import type { ResolvedModel, ResolvedTable } from "@ingestron/definitions";
import { json } from "../erp.js";
import { perFlow } from "./flows.js";
import { build, secondFlow } from "./projects.js";

export const declared = [
  "  parameters:",
  "    region: { type: string, default: north }",
  "    day: { type: date, default: '2020-01-01' }",
  "    at: { type: datetime, default: '2020-01-01T00:00:00Z' }",
  "    batch: { type: int, default: 5 }",
  "    ratio: { type: float, default: 1.5 }",
  "    full: { type: bool, default: true }",
].join("\n");
export const trigger =
  '  triggers:\n    - { name: t, type: schedule, every: { frequency: Hour, interval: 1 }, start: "2026-12-01T00:00:00Z", parameters: { load: full } }\n';

/** Flow `b` with the ingest text, its `path`, and `audit_columns` lines. */
export function flowB(path: string, audit: string[] = [], parameters = `${declared}\n`) {
  const columns =
    audit.length > 0 ? `    audit_columns:\n${audit.map((l) => `      ${l}`).join("\n")}\n` : "";
  const ingest = `${parameters}${trigger}  with:\n    path: "${path}"\n${columns}`;
  return build({ "standard.yaml": perFlow(), "flow-b.yaml": secondFlow(ingest) });
}

export const credits = (result: { model?: ResolvedModel }): ResolvedTable =>
  result.model!.tables.find((table) => table.name === "credits")!;
export const sink = (files: Record<string, string>) =>
  json(files, "pipeline/pl_erp_erp_b.json").properties.activities[0].outputs[0].parameters;
export const wrapped = (name: string) =>
  `replace(replace(replace(pipeline().parameters.${name}, '/', '_'), '\\', '_'), '..', '_')`;
