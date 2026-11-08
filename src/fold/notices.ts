// What the people who deploy the factory need to know, given as notices while generating
// every environment and kept in the platform request too (spec/behaviour.md).
import type { PackNotice, ResolvedModel } from "@ingestron/definitions";
import { addedSecretNotices } from "../factory/index.js";
import { runtimeNotices } from "../factory/index.js";

function notice({ message, hint }: { message: string; hint: string }): PackNotice {
  return { code: "PACK_NOTICE", severity: "warning", message, hint };
}

/**
 * One notice for each integration runtime a deployment writes or resets, in the order the
 * runtimes first appear. When the environments describe a runtime in different words (a linked
 * runtime's resource, a region), there is a notice per environment, each saying which.
 */
export function runtimePackNotices(models: Readonly<Record<string, ResolvedModel>>): PackNotice[] {
  const byRuntime = new Map<string, Map<string, { message: string; hint: string }>>();
  for (const [target, model] of Object.entries(models))
    for (const found of runtimeNotices(model)) {
      byRuntime.set(found.name, (byRuntime.get(found.name) ?? new Map()).set(target, found));
    }
  return [...byRuntime.values()].flatMap((targets) => {
    const wordings = new Set([...targets.values()].map((found) => found.message));
    if (wordings.size === 1) return [notice([...targets.values()][0]!)];
    return [...targets].map(([target, found]) =>
      notice({ ...found, message: `In ${target}: ${found.message}` }),
    );
  });
}

/** One notice for each secure string parameter that the export adds and every deployment must supply. */
export function addedSecretPackNotices(files: Readonly<Record<string, string>>): PackNotice[] {
  return addedSecretNotices(files).map(notice);
}
