// Every connector an ingest method reads is described, and each description
// names a method that really reads it.
import { describe, expect, it } from "vitest";
import { adf } from "../src/index.js";

const ingest = Object.entries(adf.methods).filter(([, method]) => method.action === "ingest");

describe("connector facts", () => {
  it("describes every connector an ingest method reads", () => {
    const read = new Set(ingest.flatMap(([, method]) => method.connectors ?? []));
    expect(new Set(adf.connectors?.map((connector) => connector.id))).toEqual(read);
  });

  it("names a method that reads the connector, and an https link", () => {
    for (const connector of adf.connectors ?? []) {
      const method = adf.methods[connector.method];
      expect(method?.connectors, connector.id).toContain(connector.id);
      expect(connector.docs).toMatch(/^https:\/\//);
    }
  });
});
