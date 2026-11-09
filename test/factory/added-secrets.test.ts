// The secure strings Microsoft's export adds for optional secrets a linked service
// leaves out: each is named for the deploying pipeline and the platform request, and
// counted toward ARM's limit; a Key Vault secret in its place stops it.
import { describe, expect, it } from "vitest";
import { addedSecretParameters } from "../../src/factory/added-secrets.js";
import { countProblems } from "../../src/fold/fold-checks.js";
import { adf } from "../../src/index.js";
import { generate } from "../erp.js";
import { fold, resolveAll, squareProject } from "../fold-helpers.js";

describe("secure strings the export adds", () => {
  it("are named for each linked service that leaves its optional secret out", () => {
    const { files } = generate(squareProject(""));
    expect(addedSecretParameters(files)).toEqual([
      {
        name: "ls_erp_erp_refreshToken",
        linkedService: "ls_erp_erp",
        type: "Square",
        property: "refreshToken",
        setting: "refresh_token",
      },
    ]);
  });

  it("are not added where the connection gives the secret from Key Vault", () => {
    const { files } = generate(squareProject(", refresh_token: '${secret:refresh-token}'"));
    expect(addedSecretParameters(files)).toEqual([]);
  });

  it("are values the deploying pipeline supplies, which the platform request names", () => {
    const models = resolveAll(squareProject(""), ["dev", "prod"]);
    expect(fold(models).deployValues).toContainEqual({
      name: "ls_erp_erp_refreshToken",
      suppliedAs: ["ls_erp_erp_refreshToken"],
    });
    const lines = adf.request!(models.prod!).flatMap((section) => section.lines);
    expect(lines).toContain(
      "ARM parameter `ls_erp_erp_refreshToken`: Microsoft's export adds it, a secure string with no default, for the Square linked service's optional `refreshToken`, which `ls_erp_erp` leaves out. Supply it when deploying each environment, or set the connection's `refresh_token` to a Key Vault secret so the export does not add it.",
    );
  });

  it("count toward ARM's 256 parameters", () => {
    const parameter = { name: "p", file: "trigger/t.json", path: ["properties"], type: "string" };
    const folded = { files: {}, deployValues: [], parameters: Array(255).fill(parameter) };
    const secret = { name: "s", linkedService: "l", type: "Square", property: "x", setting: null };
    expect(countProblems(folded, [])).toEqual([]);
    expect(countProblems(folded, [secret])[0]?.message).toMatch(
      /^The ARM template would have 257 parameters: factoryName, 255 for values that differ between environments and 1 secure string the export adds\./,
    );
  });
});
