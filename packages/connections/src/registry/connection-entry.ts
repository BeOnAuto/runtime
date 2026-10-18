import { ServerEntrySchema } from '@on.auto/tool-servers';
import { Schema } from 'effect';

const { type, url, document, base_url, headers, query_params, allowed, playbooks, record_content, request_id } =
  ServerEntrySchema.fields;

const neverASecret = 'never a secret or a reference';

export const ConnectionTypeSchema = type.schema.pick(['mcp', 'openapi']).annotate({
  description: 'mcp for a remote MCP server, given url; openapi for an HTTP API, given document',
});

export type ConnectionType = typeof ConnectionTypeSchema.Type;

export const ConnectionEntrySchema = Schema.Struct({
  url: url.annotate({ description: 'The https URL of the MCP server' }),
  document: document.annotate({ description: 'The https URL of the OpenAPI document of the HTTP API' }),
  base_url: base_url.annotate({ description: "The https URL the API's calls go to, in place of its document's" }),
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
