// REST and HTTP share request settings, while their native readers stay separate.
import type { ResolvedTable } from "@ingestron/definitions";
/** Explicit native web request options shown in schema-based editor help. */
export const webRequestSettings = {
  request_method: {
    enum: ["GET", "POST"],
    enumDescriptions: [
      "Read with an HTTP GET request.",
      "Read with an HTTP POST request and optional request_body.",
    ],
    description: "Web request method; defaults to GET.",
  },
  request_body: {
    type: "string",
    minLength: 1,
    examples: ['{"status":"active"}'],
    description: "POST request body; keep credentials in auth_headers secret references.",
  },
};
/** A body requires POST; it is never silently ignored for a GET request. */
export function webRequestProblems(options: Record<string, unknown>): string[] {
  return options.request_body && options.request_method !== "POST"
    ? ["request_body requires request_method: POST"]
    : [];
}
/** Only the HTTP file connector accepts web source options. */
export function httpOptionProblems(table: ResolvedTable): string[] {
  const options = (table.ingest!.settings.source_options ?? {}) as Record<string, unknown>;
  if (table.ingest!.connection.connector !== "http" && Object.keys(options).length)
    return [
      "source_options.request_method and request_body are supported only for HTTP file sources",
    ];
  return webRequestProblems(options);
}
