// The parts of an abfss:// landing URL that ADF resources need.

/** `abfss://<fileSystem>@<account>.dfs.core.windows.net/<path>`, split up. */
export interface Landing {
  /** `https://<account>.dfs.core.windows.net`, for the linked service. */
  url: string;
  fileSystem: string;
  /** Folder inside the file system, without leading or trailing `/`. */
  path: string;
}

/** Splits a landing URL; the method's settings schema has already checked its form. */
export function parseLanding(text: string): Landing {
  const match = /^abfss:\/\/([^@/]+)@([^/]+)(\/.*)?$/.exec(text);
  return {
    url: `https://${match?.[2] ?? ""}`,
    fileSystem: match?.[1] ?? "",
    path: (match?.[3] ?? "").replace(/^\/+|\/+$/g, ""),
  };
}
