// What one ARM template cannot deploy to every environment is refused before
// anything is written, with the setting, the environments, the values and a fix.
import { describe, expect, it } from "vitest";
import { base } from "./erp.js";
import { erpProject, fold, foldFailures, parametersOf, resolveAll } from "./fold-helpers.js";

const standard = base["standard.yaml"]!;

/** The ERP project in dev and prod, with the values given and the changes made. */
function folded(dev: string, prod: string, changes: Record<string, string>) {
  const project = erpProject([`  dev: { values: ${dev} }`, `  prod: { values: ${prod} }`]);
  return fold(resolveAll({ ...base, "project.yaml": project, ...changes }, ["dev", "prod"]));
}

describe("refused", () => {
  it("names that differ between environments", () => {
    const flow = base["flow.yaml"]!.replace("erp.dbo.Invoices", "'${values.db}.dbo.Invoices'");
    const { files, problems } = folded("{ db: erp_dev }", "{ db: erp }", { "flow.yaml": flow });
    expect(files).toEqual({});
    expect(problems[0]).toEqual({
      code: "ENVIRONMENTS_DIFFER",
      severity: "error",
      message:
        'The linked service is named "ls_erp_erp_erp_dev" in dev and "ls_erp_erp_erp" in prod. Settings that differ: object ("erp_dev.dbo.Invoices" in dev and "erp.dbo.Invoices" in prod).',
      file: "project.yaml",
      hint: "Resource names must be the same in every environment, because one ARM template is deployed to each factory. Name the resource with resource_names, such as resource_names.pipeline, or keep what it is named after, such as the object's database, the same in every environment.",
    });
  });

  it("integration runtime names that differ", () => {
    const changes = {
      "standard.yaml": standard.replace("shir-erp", "${values.runtime}"),
    };
    const { problems } = folded("{ runtime: shir-dev }", "{ runtime: shir-prod }", changes);
    expect(problems.map((problem) => problem.message)).toEqual([
      'The integration runtimes are shir-dev (SelfHosted) in dev and shir-prod (SelfHosted) in prod; Microsoft\'s CI/CD needs each runtime to have the same name and type in every environment. Settings that differ: integration_runtime ("shir-dev" in dev and "shir-prod" in prod).',
    ]);
    expect(problems[0]!.hint).toContain("same integration runtime name and runtime_kind");
  });

  it("integration runtime kinds that differ", () => {
    const changes = {
      "standard.yaml": standard.replace("shir-erp", "shir-erp\n      runtime_kind: ${values.kind}"),
    };
    const { problems } = folded("{ kind: self-hosted }", "{ kind: azure }", changes);
    expect(problems[0]!.message).toContain(
      "shir-erp (SelfHosted) in dev and shir-erp (Managed) in prod",
    );
  });

  it("a pipeline whose activities differ", () => {
    const changes = {
      "standard.yaml": standard.replace(
        "      start:",
        "      pattern: ${values.pattern}\n      start:",
      ),
    };
    const { problems } = folded("{ pattern: activities }", "{ pattern: foreach }", changes);
    expect(problems[0]!.code).toBe("ENVIRONMENTS_DIFFER");
    expect(problems[0]!.message).toMatch(
      /^In the pipeline "pl_erp_erp", properties\.activities\[0\] of the resource differs between environments in more than a value: .*Settings that differ: pattern \("activities" in dev and "foreach" in prod\)\.$/,
    );
  });

  it("a deploy-time value inside a longer value", () => {
    const changes = {
      "standard.yaml": standard.replace("kv-erp.vault", "${envvar:VAULT}.vault"),
    };
    expect(folded("{}", "{}", changes).problems).toEqual([
      {
        code: "DEPLOY_VALUE",
        severity: "error",
        message:
          '"${envvar:VAULT}" is supplied only when deploying, but it is part of a longer value, "https://${envvar:VAULT}.vault.azure.net", at properties.typeProperties.baseUrl of the linked service "ls_erp_keyvault"; an ARM parameter replaces a whole value.',
        file: "standard.yaml",
        line: 10,
        hint: "Make the variable hold the whole value, such as the full URL, or write the value in project.yaml for each environment.",
      },
    ]);
  });

  it("a landing folder that holds a deploy-time value", () => {
    const changes = {
      "standard.yaml": standard.replace(
        "abfss://landing@erplake.dfs.core.windows.net/erp",
        "${envvar:LANDING}/erp",
      ),
    };
    const [problem] = folded("{}", "{}", changes).problems;
    expect(problem).toMatchObject({
      code: "DEPLOY_VALUE",
      file: "standard.yaml",
      line: 8,
      hint: "Write the landing folder in project.yaml for each environment, such as abfss://landing@<account>.dfs.core.windows.net/<folder>.",
    });
    expect(problem!.message).toBe(
      '"${envvar:LANDING}" is supplied only when deploying, but the landing folder "${envvar:LANDING}/erp" holds it; ADF splits the landing into the storage account\'s URL, the file system and the folder, so each must be known when generating.',
    );
  });

  it("an integration runtime named by a deploy-time value", () => {
    const changes = { "standard.yaml": standard.replace("shir-erp", "${envvar:RUNTIME}") };
    expect(folded("{}", "{}", changes).problems[0]).toMatchObject({
      code: "DEPLOY_VALUE",
      message:
        '"${envvar:RUNTIME}" is supplied only when deploying, so it cannot name the integration runtime "${envvar:RUNTIME}"; a factory\'s resources are named when generating.',
      hint: "Write the integration runtime's name in project.yaml for each environment.",
    });
  });

  it("two deploy-time values at one place", () => {
    const changes = {
      "standard.yaml": standard.replace("https://kv-erp.vault.azure.net", "${values.vault}"),
    };
    const { problems } = folded(
      "{ vault: '${envvar:DEV_VAULT}' }",
      "{ vault: '${envvar:PROD_VAULT}' }",
      changes,
    );
    expect(problems[0]).toMatchObject({
      code: "DEPLOY_VALUE",
      message: "This value is ${envvar:DEV_VAULT} in dev and ${envvar:PROD_VAULT} in prod.",
    });
  });

  it("more than 256 parameters, with the count", () => {
    const tables = Array.from(
      { length: 255 },
      (_, index) => `  t${index}: { object: erp.dbo.T${index}, contract: invoices }`,
    );
    const changes = {
      "standard.yaml": standard.replace(
        "      start:",
        "      audit_columns: { _environment: '${environment.name}' }\n      start:",
      ),
      "flow.yaml": `apiVersion: ingestron.io/v1\nkind: Flow\nid: erp\nsource: erp\ntables:\n${tables.join("\n")}\n`,
    };
    expect(folded("{}", "{}", changes).problems).toEqual([
      {
        code: "ARM_PARAMETERS",
        severity: "error",
        message:
          "The ARM template would have 257 parameters: factoryName and 256 for values that differ between environments. Azure Resource Manager allows 256. The most come from properties.activities[].typeProperties.source.additionalColumns[].value of each pipeline (255), properties.runtimeState of each trigger (1).",
        file: "project.yaml",
        hint: "Microsoft suggests three ways: make fewer values differ between environments, such as an audit column that holds the environment's name; give values that are the same in many places one global parameter; or split the definitions into more than one factory.",
      },
    ]);
  });
});

describe("folded", () => {
  it("a deploy-time value in some environments, left for the deploying pipeline there", () => {
    const changes = {
      "standard.yaml": standard.replace("https://kv-erp.vault.azure.net", "${values.vault}"),
    };
    const models = resolveAll(
      {
        ...base,
        ...changes,
        "project.yaml": erpProject([
          "  dev: { values: { vault: '${envvar:DEV_VAULT}' } }",
          "  prod: { values: { vault: 'https://kv-erp.vault.azure.net' } }",
        ]),
      },
      ["dev", "prod"],
    );
    const { files, deployValues, problems } = fold(models);
    expect(problems).toEqual([]);
    const parameter = "ls_erp_keyvault_properties_typeProperties_baseUrl";
    expect(deployValues).toEqual([{ name: "DEV_VAULT", suppliedAs: [parameter] }]);
    expect(parametersOf(files, "dev")[parameter]).toBeUndefined();
    expect(parametersOf(files, "prod")[parameter]).toBe("https://kv-erp.vault.azure.net");
    expect(files["factory/linkedService/ls_erp_keyvault.json"]).toContain('"<value of DEV_VAULT>"');
    expect(foldFailures(models)).toEqual([]);
  });

  it("a secret whose name differs, with a warning", () => {
    const erp = base["erp.yaml"]!.replace("${secret:erp-sql-password}", "${values.password}");
    const { files, problems } = folded(
      "{ password: '${secret:erp-dev}' }",
      "{ password: '${secret:erp-prod}' }",
      { "erp.yaml": erp },
    );
    expect(problems).toEqual([
      {
        code: "SECRET_NAME_DIFFERS",
        severity: "warning",
        message:
          'The Key Vault secret of the linked service "ls_erp_erp_erp" is named "erp-dev" in dev and "erp-prod" in prod. It is a parameter, so it deploys, but Microsoft recommends a vault per environment with the same secret names, so that only the vault\'s URL differs.',
        file: "project.yaml",
      },
    ]);
    expect(
      parametersOf(files, "prod").ls_erp_erp_erp_properties_typeProperties_password_secretName,
    ).toBe("erp-prod");
  });
});
