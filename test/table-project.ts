import { base } from "./erp.js";
export const tableProject = (connector: string, settings: string, object = "sales.orders") => ({
  "standard.yaml": base["standard.yaml"]!.replace("adf-copy:", "adf-table:"),
  "erp.yaml": `apiVersion: ingestron.io/v1\nkind: Connection\nid: erp\nconnector: ${connector}\nconnectivity: private\nsettings:\n${settings}\n`,
  "flow.yaml": base["flow.yaml"]!.replace("erp.dbo.Invoices", object),
});
