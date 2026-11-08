/** Whether resolved connection or method data contains a Key Vault secret reference. */
export function needsVault(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Object.hasOwn(value, "$secret")) return true;
  return Object.values(value).some(needsVault);
}
