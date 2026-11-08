// What the ADF pack does with each ODCS contract field. ADF only copies, so
// most fields are handled where the table is stored.
import { contractCommon, type ContractUse } from "@ingestron/definitions";

const used = (does: string): ContractUse => ({ use: "used", does });
const stored = { use: "elsewhere", reason: "Handled where the table is stored." } as const;
const object = "schema.*";
const column = "schema.*.properties.*";

/** The ADF pack's use of every contract field, by path. */
export const contract: Record<string, ContractUse> = {
  ...contractCommon,
  schema: used("One object per table; each table uses the object named like it."),
  [`${object}.name`]: used("Matched to the table by its name."),
  [`${object}.logicalType`]: { use: "documentation" },
  [`${object}.physicalName`]: {
    use: "elsewhere",
    reason: "The source table is the flow table's object.",
  },
  [`${object}.physicalType`]: stored,
  [`${object}.description`]: stored,
  [`${object}.properties`]: used(
    "adf-copy selects these columns from the source; adf-files copies files as they are.",
  ),
  [`${object}.relationships`]: stored,
  [`${object}.quality`]: stored,
  [`${object}.tags`]: stored,
  [`${column}.name`]: used("adf-copy selects the column by this name."),
  [`${column}.physicalName`]: used(
    "The column's name at the source: adf-copy selects it under the contract's name; adf-files copies files as they are, and the store renames.",
  ),
  [`${column}.logicalType`]: {
    use: "elsewhere",
    reason: "The copy keeps the source's types; the store applies the contract's.",
  },
  [`${column}.physicalType`]: {
    use: "elsewhere",
    reason: "The copy keeps the source's types; the store applies the contract's.",
  },
  ...Object.fromEntries(
    [
      "required",
      "primaryKey",
      "primaryKeyPosition",
      "logicalTypeOptions",
      "unique",
      "partitioned",
      "partitionKeyPosition",
      "classification",
      "encryptedName",
      "relationships",
      "quality",
      "description",
      "tags",
      "properties",
      "items",
    ].map((key) => [`${column}.${key}`, stored]),
  ),
};
