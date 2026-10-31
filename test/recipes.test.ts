// The connector catalogue ships with the pack: one tested connection and flow
// per connector, which `ingestron init` and the documentation start from.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { adf, recipesFolder } from "../src/index.js";

it("ships a connection and a flow for every connector the pack reads", () => {
  expect(existsSync(join(recipesFolder, "standard.yaml"))).toBe(true);
  const names = (folder: string) =>
    readdirSync(join(recipesFolder, folder)).map((file) => file.replace(/\.yaml$/, ""));
  const ids = adf.connectors!.map((connector) => connector.id);
  expect(names("connections")).toEqual(expect.arrayContaining(ids));
  expect(names("flows")).toEqual(expect.arrayContaining(ids));
});
