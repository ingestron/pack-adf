import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { adf } from "../src/index.js";

const cases = JSON.parse(
  readFileSync(new URL("../spec/conformance/reading-metadata.json", import.meta.url), "utf8"),
);
for (const { id, ...reading } of cases) {
  it(`describes ${id} reading options from the source's validation facts`, () => {
    expect(adf.connectors?.find((source) => source.id === id)).toHaveProperty("reading", reading);
  });
}
