import { expect, it } from "vitest";
import { generate, json } from "./erp.js";
import { tableProject } from "./table-project.js";
const flow = tableProject("rest", "  url: https://source.example.test", "orders");
it("uses root JSON paths unless a collection reference is selected", () => {
  let run = generate(flow);
  expect(
    json(run.files, "pipeline/pl_erp_erp.json").properties.activities[0].typeProperties.translator
      .mappings[0].source.path,
  ).toBe("$['invoice_id']");
  const selected = {
    ...flow,
    "standard.yaml":
      flow["standard.yaml"] +
      "      source_options: { collection_reference: \"$['items']\", column_paths: { amount: \"['price']['value']\" } }\n",
  };
  run = generate(selected);
  expect(run.result.model, JSON.stringify(run.result.diagnostics)).toBeDefined();
  const translator = json(run.files, "pipeline/pl_erp_erp.json").properties.activities[0]
    .typeProperties.translator;
  expect(translator.collectionReference).toBe("$['items']");
  expect(translator.mappings[0].source.path).toBe("['invoice_id']");
  expect(translator.mappings[1].source.path).toBe("['price']['value']");
});
it("keeps REST authentication headers as secret references", () => {
  const project = tableProject(
    "rest",
    '  url: https://source.example.test\n  auth_headers: { X-Api-Key: "${secret:api-key}" }',
    "orders",
  );
  const { result, files } = generate(project);
  expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
  expect(
    json(files, "linkedService/ls_erp_erp.json").properties.typeProperties.authHeaders["X-Api-Key"]
      .secretName,
  ).toBe("api-key");
  project["erp.yaml"] = project["erp.yaml"]!.replace("${secret:api-key}", "literal");
  expect(generate(project).result.model).toBeUndefined();
});
it("uses application credentials and native column objects for Microsoft 365 JSON", () => {
  const project = tableProject(
    "microsoft-365",
    "  tenant: tenant\n  application_tenant: tenant\n  client_id: app\n  client_secret: ${secret:app-secret}",
    "BasicDataSet_v0.Message_v1",
  );
  project["standard.yaml"] +=
    "      runtime_kind: azure\n      format: json\n      source_options: { requires_date_filter: true, date_filter_column: CreatedDateTime }\n";
  const { result, files } = generate(project);
  expect(result.model, JSON.stringify(result.diagnostics)).toBeDefined();
  const copy = json(files, "pipeline/pl_erp_erp.json").properties.activities[0].typeProperties;
  expect(copy.source.outputColumns[0]).toEqual({ name: "invoice_id" });
  expect(copy.source.startTime.value).toBe("@pipeline().parameters.windowStart");
  expect(copy.sink.type).toBe("JsonSink");
  expect(copy.translator).toBeUndefined();
  expect(
    json(files, "linkedService/ls_erp_erp_json.json").properties.typeProperties.servicePrincipalKey
      .secretName,
  ).toBe("app-secret");
});
