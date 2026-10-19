import { Schema } from 'effect';

export const toolServersSetting = 'TOOL_SERVERS';

const referencedValues =
  'the value of a reference such as ${GRAPH_API_KEY} is a secret, scrubbed from everything a call records, and a value written out is not';

const pinnedUrl = 'An https URL, or an http URL on a loopback address';

const AuthSchema = Schema.Struct({
  issuer: Schema.String.annotate({
    description: `The issuer of the authorization server the credential was registered with, pinned: it is sent to no other. ${pinnedUrl}`,
  }),
  client_id: Schema.String.annotate({ description: 'The client id registered with that authorization server' }),
  client_secret: Schema.optionalKey(
    Schema.String.annotate({ description: 'The client secret, as a reference such as ${GRAPH_CLIENT_SECRET}' }),
  ),
  private_key: Schema.optionalKey(
    Schema.String.annotate({
      description: 'A private key in PEM that signs the client assertion, as a reference such as ${GRAPH_PRIVATE_KEY}',
    }),
  ),
  algorithm: Schema.optionalKey(
    Schema.String.annotate({ description: 'The signing algorithm of private_key, such as RS256 or ES256' }),
  ),
  scope: Schema.optionalKey(Schema.String.annotate({ description: 'The scopes to ask for, separated by spaces' })),
}).annotate({
  description:
    "OAuth client credentials, for a server whose authorization server issues tokens to clients: client_secret, or private_key with its algorithm. An mcp server's authorization server is found from the server's own metadata, an openapi server's from the issuer's",
});

const remoteFields = {
  headers: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String).annotate({
      description: `Headers sent to a remote MCP server, or to an HTTP API outside its document's security schemes, with every request; ${referencedValues}`,
    }),
  ),
  auth: Schema.optionalKey(AuthSchema),
};

const mcpFields = {
  url: Schema.optionalKey(
    Schema.String.annotate({
      description: 'The http or https URL of a remote MCP server, spoken to over Streamable HTTP',
    }),
  ),
};

const stdioFields = {
  command: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'The command of a stdio server: an installed, pinned program, never a package downloaded at start such as npx -y',
    }),
  ),
  args: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({ description: 'The arguments of the command of a stdio server' }),
  ),
  env: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String).annotate({
      description: `The whole environment of the process of a stdio server, which inherits nothing else; ${referencedValues}`,
    }),
  ),
};

const openApiFields = {
  document: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'The OpenAPI document of an HTTP API, version 3.0 or 3.1, read once at start: an https URL, an http URL on a loopback address, or a path relative to the directory of the configuration file',
    }),
  ),
  base_url: Schema.optionalKey(
    Schema.String.annotate({
      description: `The URL the calls of an HTTP API go to, in place of the first server its document names; required when it names none. ${pinnedUrl}`,
    }),
  ),
  query_params: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String).annotate({
      description: `Query parameters sent to an HTTP API with every call, outside its document's security schemes, such as a tenant; ${referencedValues}`,
    }),
  ),
  security: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String).annotate({
      description: `The credential of each security scheme of an HTTP API's document the entry gives, by the scheme's name, placed as the scheme says: an apiKey in its header or query parameter, a bearer as Authorization: Bearer, a basic as user:password; an oauth2 or openIdConnect scheme takes the auth block instead; each value is a reference such as \${BILLING_API_KEY} or ada:\${BILLING_PASSWORD}, a secret, and one written out is refused`,
    }),
  ),
};

const servedFields = {
  org: Schema.optionalKey(
    Schema.Union([Schema.String, Schema.Array(Schema.String)]).annotate({
      description:
        'The org this server serves, a list of orgs, or * for every org of this server, required; one entry serves each org it names under one name, with one credential and one connection',
    }),
  ),
  playbooks: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description:
        'The playbooks this server serves within each org it names, by id; every playbook of each org when left out, and refused beside * for every org',
    }),
  ),
  allowed: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description:
        'The tools of this server a function may name, each named as the server lists it; every tool of the server when left out',
    }),
  ),
  record_content: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "Whether the arguments and the answers of this server's calls are kept whole, scrubbed of secrets, in the playbook's ledger, where anyone who may read the playbook reads them; false keeps their sizes alone. Default true",
    }),
  ),
  request_id: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'The response header, or for an MCP server the key of the metadata of a result, in which the server carries its own id of a request, recorded with each call',
    }),
  ),
};

const CredentialFieldsSchema = Schema.Struct({
  kind: Schema.optionalKey(
    Schema.String.annotate({ description: 'The way of the provider the credential takes, when not its first' }),
  ),
  value: Schema.optionalKey(
    Schema.String.annotate({ description: 'For a secret, a reference such as ${TRACKER_TOKEN}' }),
  ),
  client_id: Schema.optionalKey(
    Schema.String.annotate({ description: 'For client credentials, the client id, written out' }),
  ),
  client_secret: Schema.optionalKey(
    Schema.String.annotate({ description: 'For client credentials, a reference such as ${LEDGERS_CLIENT_SECRET}' }),
  ),
  private_key: Schema.optionalKey(
    Schema.String.annotate({
      description: 'For client credentials, a private key in PEM as a reference such as ${LEDGERS_PRIVATE_KEY}',
    }),
  ),
  algorithm: Schema.optionalKey(
    Schema.String.annotate({ description: 'The signing algorithm of private_key, such as RS256 or ES256' }),
  ),
});

const providerFields = {
  provider: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'A provider the runtime knows, by its name, which gives the server and where its credential goes: the entry then gives placeholders, credential, org, playbooks, allowed and record_content, and no field of the server',
    }),
  ),
  placeholders: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String).annotate({
      description: "With provider, the value of each of the provider's placeholders, by name, never a reference",
    }),
  ),
  credential: Schema.optionalKey(
    Schema.Union([
      Schema.String.annotate({ description: 'For a secret, a reference such as ${TRACKER_TOKEN}' }),
      CredentialFieldsSchema,
    ]).annotate({
      description:
        'With provider, the credential of its first way, or of the way kind names: a secret as a reference such as ${TRACKER_TOKEN}, or client credentials as the client id written out with client_secret, or with private_key and its algorithm, each key a reference; nothing for a way that takes none',
    }),
  ),
};

export const ServerEntrySchema = Schema.Struct({
  type: Schema.optionalKey(
    Schema.Literals(['mcp', 'stdio', 'openapi']).annotate({
      description:
        'mcp for a remote MCP server, given url; stdio for an MCP server this server starts as a process, given command; openapi for an HTTP API, given document. Taken from url, command or document when left out',
    }),
  ),
  ...mcpFields,
  ...remoteFields,
  ...stdioFields,
  ...openApiFields,
  ...servedFields,
  ...providerFields,
});

export type ServerEntryFields = typeof ServerEntrySchema.Type;

export const ToolServersSchema = Schema.Record(
  Schema.String.annotate({
    description:
      'The name a function gives the server in server/tool: 1 to 32 lowercase letters, digits and hyphens, starting with a letter, with no two hyphens together and none at the end, and not the name of a model provider or gateway',
  }),
  ServerEntrySchema,
);
