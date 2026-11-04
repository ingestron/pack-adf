// What the people who deploy the factory need to know, given as notices while generating
// every environment, and the same words in the platform request.
import { environmentsDiagnostics } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { adf } from "../src/index.js";
import { base } from "./erp.js";
import {
  erpProject,
  fold,
  linkedRuntime,
  managedRuntime,
  resolveAll,
  sharedRuntime,
  squareProject,
} from "./fold-helpers.js";

const notices = (models: Parameters<typeof fold>[0]) =>
  fold(models).problems.filter((problem) => problem.code === "PACK_NOTICE");

const secrets = (models: Parameters<typeof fold>[0]) =>
  notices(models).filter((problem) => problem.message.startsWith("ARM parameter"));

const whatIf =
  "Before the first deployment to a factory that already has these integration runtimes, run `az deployment group what-if` with the template and that environment's parameter file, and check that it changes no runtime in a way you did not describe.";

describe("integration runtime notices", () => {
  it("name what a deployment does to a self-hosted runtime, with the check to run first", () => {
    const models = resolveAll(
      { ...base, "project.yaml": erpProject(["  dev: {}", "  prod: {}"]) },
      ["dev", "prod"],
    );
    expect(notices(models)).toEqual([
      {
        code: "PACK_NOTICE",
        severity: "warning",
        message:
          "Integration runtime `shir-erp` (self-hosted): the deployment writes it by name and type, as Data Factory Studio does; where it creates it, register a node, with network access and any required source drivers, before the copies run.",
        hint: whatIf,
      },
    ]);
  });

  it("say which environment, when a linked runtime points at a different shared one in each", () => {
    const found = notices(resolveAll(linkedRuntime(), ["dev", "prod"]));
    expect(found).toHaveLength(2);
    expect(found[0]?.message).toMatch(
      /^In dev: Integration runtime `shir-erp` \(self-hosted, linked\)/,
    );
    expect(found[1]?.message).toMatch(
      /^In prod: Integration runtime `shir-erp` \(self-hosted, linked\)/,
    );
    expect(found[0]?.message).toContain(sharedRuntime(1));
    expect(found[1]?.message).toContain(sharedRuntime(2));
  });

  it("describe an Azure runtime in a managed virtual network once, as both environments agree", () => {
    const found = notices(resolveAll(managedRuntime(), ["dev", "prod"]));
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toMatch(/^Integration runtime `ir-erp` \(Azure\)/);
    expect(found[0]?.message).toContain("managed virtual network");
  });

  it("are warnings that leave the files written, at no location", () => {
    const models = resolveAll(managedRuntime(), ["dev", "prod"]);
    const { files, problems } = fold(models);
    expect(Object.keys(files).length).toBeGreaterThan(0);
    const diagnostics = environmentsDiagnostics(problems);
    expect(diagnostics.filter((item) => item.code === "PACK_NOTICE")).toHaveLength(1);
    expect(diagnostics.every((item) => item.severity === "warning")).toBe(true);
  });

  it("stay in the platform request", () => {
    const models = resolveAll(managedRuntime(), ["dev", "prod"]);
    const lines = adf.request!(models.prod!).flatMap((section) => section.lines);
    expect(lines).toContain(notices(models)[0]!.message);
    expect(lines).toContain(whatIf);
  });

  it("are not given for ADF's own Azure runtime", () => {
    const standard = base["standard.yaml"]!.replace(
      "      integration_runtime: shir-erp\n",
      "      integration_runtime: AutoResolveIntegrationRuntime\n      runtime_kind: azure\n",
    );
    expect(standard).not.toBe(base["standard.yaml"]);
    const files = { ...base, "standard.yaml": standard };
    const models = resolveAll(
      { ...files, "project.yaml": erpProject(["  dev: {}", "  prod: {}"]) },
      ["dev", "prod"],
    );
    expect(notices(models)).toEqual([]);
  });
});

describe("export-added secret notices", () => {
  const square = () => resolveAll(squareProject(""), ["dev", "prod"]);

  it("name each parameter the export adds, and how to supply it or stop it", () => {
    expect(secrets(square())).toEqual([
      {
        code: "PACK_NOTICE",
        severity: "warning",
        message:
          "ARM parameter `ls_erp_erp_refreshToken`: Microsoft's export adds it, a secure string with no default, for the Square linked service's optional `refreshToken`, which `ls_erp_erp` leaves out.",
        hint: "Supply it when deploying each environment, or set the connection's `refresh_token` to a Key Vault secret so the export does not add it.",
      },
    ]);
  });

  it("are not given where the connection gives the secret from Key Vault", () => {
    const models = resolveAll(squareProject(", refresh_token: '${secret:refresh-token}'"), [
      "dev",
      "prod",
    ]);
    expect(secrets(models)).toEqual([]);
  });

  it("stay in the platform request as one line, message and hint together", () => {
    const models = square();
    const [found] = secrets(models);
    const lines = adf.request!(models.prod!).flatMap((section) => section.lines);
    expect(lines).toContain(`${found!.message} ${found!.hint}`);
  });
});
