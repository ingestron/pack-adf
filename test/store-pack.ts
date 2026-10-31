// A minimal store pack for the ADF tests. It stores what ADF lands as tables and
// builds nothing, so the ADF pack is tested through the pack interface alone.
// Tests with the real Databricks pack are in the CLI, which combines packs.
import type { Pack } from "@ingestron/definitions";

export const store: Pack = {
  id: "store",
  version: 1,
  defaults: {
    naming: {
      catalog: "{{ environment }}",
      schema: "{{ layer }}",
      table: "{{ table }}",
      pipeline: "{{ project }}",
      job: "{{ project }}_refresh",
    },
    layers: ["bronze", "silver", "gold"],
    types: {
      string: "STRING",
      integer: "BIGINT",
      number: "DOUBLE",
      boolean: "BOOLEAN",
      date: "DATE",
      timestamp: "TIMESTAMP",
    },
    quality: { required: "warn", default: "warn" },
  },
  rules: { store: { default: "table" } },
  methods: {
    table: {
      action: "store",
      description: "Stores what the ingest method hands over as a table.",
      accepts: ["files", "table"],
      produces: "table",
      settings: { type: "object" },
    },
  },
  build: () => ({}),
};
