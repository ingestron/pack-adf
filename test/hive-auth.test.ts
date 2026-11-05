// Hive's transport decides its authentication: Microsoft's Hive connector supports only
// Anonymous over Binary and UsernameAndPassword over SASL (spec/references.md). Checked here
// and, for the catalogue's Binary Hive connection, through Microsoft's own export.
import { describe, expect, it } from "vitest";
import { exportFixtures } from "./export-fixtures.js";
import { generate } from "./erp.js";
import { fold } from "./fold-helpers.js";
import { exportTemplate, exportTool, writeFolder } from "./microsoft-export.js";
import { tableProject } from "./table-project.js";

const hive = (settings: string[]) =>
  generate(tableProject("hive", settings.join("\n"), "sales.orders"));
const host = ["  host: hive.example.test", "  port: 10000"];
const login = ["  user: reader", "  password: ${secret:source-password}"];

function service(files: Record<string, string>) {
  const [, text] = Object.entries(files).find(
    ([path, body]) => path.startsWith("linkedService/") && body.includes('"type": "Hive"'),
  )!;
  return JSON.parse(text).properties.typeProperties;
}

describe("Hive authentication", () => {
  it("connects anonymously over Binary transport, with no user or password", () => {
    const { result, files } = hive([...host, "  transport: Binary"]);
    expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
    const properties = service(files);
    expect(properties.authenticationType).toBe("Anonymous");
    expect(properties.thriftTransportProtocol).toBe("Binary");
    expect(properties.username).toBeUndefined();
    expect(properties.password).toBeUndefined();
  });

  it("signs in with user and password over SASL", () => {
    const { files } = hive([...host, ...login, "  transport: SASL"]);
    expect(service(files)).toMatchObject({
      authenticationType: "UsernameAndPassword",
      username: "reader",
    });
  });

  it.each([
    [
      [...host, ...login, "  transport: Binary"],
      "Binary transport connects anonymously: leave out user and password, or use another transport",
    ],
    [
      [...host, "  transport: SASL"],
      'SASL transport needs "settings.user" and "settings.password"',
    ],
  ])("refuses a login that does not fit the transport", (settings, message) => {
    const { result } = hive(settings);
    expect(result.model).toBeUndefined();
    expect(result.diagnostics.map((item) => item.message).join("\n")).toContain(message);
  });
});

const required = process.env.INGESTRON_REQUIRE_ADF_EXPORT === "1";
const tool = await exportTool(required);

describe.skipIf(!tool.bundle)("Hive through Microsoft's export", { timeout: 120_000 }, () => {
  it("keeps the catalogue's Binary Hive connection anonymous", () => {
    const built = fold(exportFixtures["the connector catalogue"]!);
    const template = exportTemplate(tool.bundle!, `${writeFolder(built.files)}/factory`);
    type Resource = { properties: { type?: string; typeProperties: Record<string, unknown> } };
    const resource = (template.resources as Resource[]).find(
      (item) => item.properties.type === "Hive",
    )!;
    const properties = resource.properties.typeProperties;
    expect(properties.authenticationType).toBe("Anonymous");
    expect(properties.thriftTransportProtocol).toBe("Binary");
    expect(properties.username).toBeUndefined();
  });
});
