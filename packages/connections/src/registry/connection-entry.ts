import { sha256Of } from '@on.auto/content';
import { ServerEntrySchema } from '@on.auto/tool-servers';
import { Schema } from 'effect';

const { type, url, document, base_url, headers, query_params, allowed, playbooks, record_content, request_id } =
  ServerEntrySchema.fields;

const neverASecret = 'never a secret or a reference';

export const mostDocumentTextBytes = 16_384;

export const ConnectionTypeSchema = type.schema.pick(['mcp', 'openapi']).annotate({
  description: 'mcp for a remote MCP server, given url; openapi for an HTTP API, given document or document_text',
});

export type ConnectionType = typeof ConnectionTypeSchema.Type;

export const ConnectionEntrySchema = Schema.Struct({
  url: url.annotate({ description: 'The https URL of the MCP server' }),
  document: document.annotate({
    description:
      "The https URL of the OpenAPI document of the HTTP API, where the service's own documentation states it",
  }),
  base_url: base_url.annotate({
    description: "The https URL the API's calls go to, in place of its document's; required with document_text",
  }),
  headers: headers.annotate({ description: `Headers sent with each request, ${neverASecret}` }),
  query_params: query_params.annotate({ description: `Query parameters sent with each call, ${neverASecret}` }),
  allowed: allowed.annotate({ description: 'The tools a function may name; every tool when left out' }),
  playbooks: playbooks.annotate({ description: 'The playbooks that may use it, by id; every one when left out' }),
  record_content: record_content.annotate({
    description: "Whether calls are kept whole in the playbook's history; true when left out",
  }),
  request_id: request_id.annotate({ description: "The header or result metadata key of the server's id of a call" }),
}).annotate({ description: 'The tool server, without its credential' });

export type ConnectionEntry = typeof ConnectionEntrySchema.Type;

const documentFields = {
  sha256: Schema.String.annotate({ description: 'The SHA-256 of its text in UTF-8, in hexadecimal' }),
  bytes: Schema.Int.annotate({ description: 'The size of its text in UTF-8, in bytes' }),
  tool_count: Schema.Int.annotate({
    description: 'The number of tools it offers, as the runtime read it when the connection was added',
  }),
};

export const ConnectionDocumentSchema = Schema.Struct(documentFields).annotate({
  description:
    'The OpenAPI document given in document_text when the connection was added, kept by the runtime, which reads it from the connection and from no address; never its text',
});

export type ConnectionDocument = typeof ConnectionDocumentSchema.Type;

export function connectionDocumentOf(text: string, toolCount: number): ConnectionDocument {
  return { sha256: sha256Of(text), bytes: bytesOfText(text), tool_count: toolCount };
}

export function bytesOfText(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function entryServing(
  { playbooks: _servedBefore, ...entry }: ConnectionEntry,
  served: readonly string[] | null,
): ConnectionEntry {
  return served === null ? entry : { ...entry, playbooks: served };
}

export function servesTheSamePlaybooks(entry: ConnectionEntry, given: readonly string[] | null): boolean {
  const before = entry.playbooks ?? null;
  if (before === null || given === null) {
    return before === given;
  }
  const served = new Set(before);
  const named = new Set(given);
  return served.size === named.size && [...named].every((playbook) => served.has(playbook));
}
