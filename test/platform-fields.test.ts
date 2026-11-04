// The Platform settings the pack lists for tools to show.
import { memoryFiles } from "@ingestron/config";
import { documentReference, resolveDefinitions } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { adf } from "../src/index.js";
import { base } from "./erp.js";
import { store } from "./store-pack.js";

describe("platform fields", () => {
  it("lists only schedule.paused: a trigger's state follows it, and mode is not read", () => {
    expect(adf.platformFields).toEqual(["schedule.paused"]);
  });

  it("lists only fields the Platform document has", () => {
    const known = new Set(documentReference("Platform").map((field) => field.path.join(".")));
    for (const path of adf.platformFields ?? []) expect(known.has(path), path).toBe(true);
  });

  it("is accepted when resolving, and a field the Platform lacks is refused", () => {
    const resolve = (pack: typeof adf) =>
      resolveDefinitions(memoryFiles(base), { packs: [store, pack], environment: "dev" });
    expect(() => resolve(adf)).not.toThrow();
    expect(() => resolve({ ...adf, platformFields: ["schedule.nothing"] })).toThrow(
      'lists the platform field "schedule.nothing"',
    );
  });
});
