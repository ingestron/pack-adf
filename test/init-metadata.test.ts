// What a new project's README.md says about where to find each value: `find` on connection
// settings and on the platform settings' schemas (definitions specification, "Connector
// authoring metadata"). Portal paths are recorded in spec/references.md.
import { describe, expect, it } from "vitest";
import { adf } from "../src/index.js";

const connector = (id: string, method: string) =>
  adf.connectors!.find((item) => item.id === id && item.method === method)!;
const setting = (id: string, method: string, name: string) =>
  connector(id, method).settings.find((item) => item.name === name);
const schema = (method: string) =>
  (adf.methods[method]!.settings as { properties: Record<string, { find?: string }> }).properties;

describe("where to find a value", () => {
  it("says where to find a SQL source's server and login, never a secret's", () => {
    expect(setting("sqlserver", "adf-copy", "server")?.find).toMatch(/database administrator/);
    expect(setting("sqlserver", "adf-copy", "user")?.find).toMatch(/login/);
    expect(setting("sqlserver", "adf-copy", "password")?.find).toBeUndefined();
  });

  it("carries it through to the table connectors' database fields", () => {
    expect(setting("postgresql", "adf-table", "server")?.find).toMatch(/database administrator/);
    expect(setting("hive", "adf-table", "host")?.find).toMatch(/administrator/);
  });

  it.each(["adf-copy", "adf-table", "adf-files"])(
    "says where %s's landing storage, Key Vault and integration runtime are",
    (method) => {
      expect(schema(method).landing?.find).toBe(
        "Azure portal: Storage accounts, the account, then Data storage, Containers.",
      );
      expect(schema(method).key_vault?.find).toMatch(/^Azure portal: Key vaults/);
      expect(schema(method).integration_runtime?.find).toBe(
        "Data Factory Studio: Manage, then Integration runtimes.",
      );
    },
  );
});
