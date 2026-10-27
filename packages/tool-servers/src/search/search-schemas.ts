import { PlaybookIdSchema } from '@on.auto/operations';
import { Schema } from 'effect';

import { UnavailableBecauseSchema } from '../listing/tool-server.ts';
import { serverNamePattern } from '../names/tool-reference.ts';
import { searchBounds, termsWithinTheirBound } from './search-terms.ts';

const searchFields = {
  terms: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "Words to find tools by, up to 8 of up to 64 characters, separated by spaces; a word counts most in a tool's name, then in its arguments, then in its description",
    }).check(Schema.isMaxLength(searchBounds.termsCharacters), Schema.makeFilter(termsWithinTheirBound)),
  ),
  server: Schema.optionalKey(
    Schema.String.annotate({
      description: 'Searches only the tool server of this name, as a function writes it before the slash',
    }).check(Schema.isPattern(serverNamePattern)),
  ),
  only: Schema.optionalKey(
    Schema.Literals(['read', 'write']).annotate({
      description: 'read keeps the tools their server marks read-only, write the others, which may change something',
    }),
  ),
};

export const SearchInputSchema = Schema.Struct(searchFields);

export const OrgSearchInputSchema = Schema.Struct({
  playbook: Schema.optionalKey(
    PlaybookIdSchema.annotate({
      description:
        'The id of a playbook, to search only the tool servers its functions may use; without it, every tool server of the org',
    }),
  ),
  ...searchFields,
});

const serverFields = {
  name: Schema.String.annotate({
    description: 'The name of the server, which a function writes before the slash, as in graph/search or graph/*',
  }),
  type: Schema.Literals(['mcp', 'stdio', 'openapi']).annotate({
    description:
      'mcp for a remote MCP server, stdio for an MCP server this server starts as a process, openapi for an HTTP API described by an OpenAPI document',
  }),
  record_content: Schema.Boolean.annotate({
    description:
      "Whether the arguments and the answers of the server's calls are kept whole in the playbook's ledger, where anyone who may read the playbook reads them; false only when its entry sets record_content: false",
  }),
  connection: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'The id of the connection, for a tool server a person added to the org as one; absent for one whoever runs this server set up',
    }),
  ),
  provider: Schema.NullOr(Schema.String).annotate({
    description:
      'The name of the provider the server is made from, by a person or by whoever runs this server; null for a server given by hand',
  }),
};

const searchedFields = {
  tool_count: Schema.Int.annotate({
    description: 'How many of its tools the operator allows that this search considered, after only',
  }),
};

const unavailableFields = {
  unavailable: Schema.String.annotate({ description: 'Why the server could not be asked for its tools, in words' }),
  because: UnavailableBecauseSchema.annotate({
    description:
      'key_refused when the server did not accept the key this server gives it, which only whoever runs this server can put right; scope_lacking when it asks for a scope the credential lacks, which the words name, so asking again will not help until a credential is granted it; failing, rate_limited or unreachable when asking again later may work; connection_pending when nobody has approved the connection yet, connection_broken when its server answered 401, its credential is gone from the secret store or is not the tokens of a consent, its consent was revoked or has ended, or its client is no longer registered, in words that say what mends it, connection_not_allowed when a rule of whoever runs this server no longer allows it, and connection_unavailable when its credential cannot be read just now, so asking again later may work',
  }),
};

const servedPlaybooksFields = {
  playbooks: Schema.Array(Schema.String).annotate({
    description: "The playbooks of the org whose functions may use the server, or ['*'] for every playbook of the org",
  }),
};

const FoundToolSchema = Schema.Struct({
  server: Schema.String.annotate({
    description: 'The tool server of the tool, as a function writes it before the slash',
  }),
  tool: Schema.String.annotate({ description: 'The name of the tool, which a function writes after the slash' }),
  summary: Schema.String.annotate({
    description: 'The first sentence of what the tool does, as its server describes it, at most 300 characters',
  }),
  read_only: Schema.Boolean.annotate({ description: 'Whether its server marks the tool read-only' }),
});

const foundFields = {
  tools: Schema.Array(FoundToolSchema).annotate({
    description:
      'The tools found, best first with terms and in the order of the servers without; at most 100, and none without terms when the servers offer more',
  }),
  scopes: Schema.Array(Schema.String).annotate({ description: 'The names of the tool servers searched' }),
};

export const FoundSchema = Schema.Struct({
  servers: Schema.Array(
    Schema.Union([
      Schema.Struct({ ...serverFields, ...searchedFields }),
      Schema.Struct({ ...serverFields, ...unavailableFields }),
    ]),
  ).annotate({ description: 'The tool servers searched, sorted by name; empty when none is set up' }),
  ...foundFields,
});

const FoundProviderSchema = Schema.Struct({
  name: Schema.String.annotate({ description: "The provider's name, which add_connection takes as provider" }),
  title: Schema.String.annotate({ description: 'What a person reads' }),
  description: Schema.String.annotate({ description: 'What a function may do with it' }),
});

export const OrgFoundSchema = Schema.Struct({
  servers: Schema.Array(
    Schema.Union([
      Schema.Struct({ ...serverFields, ...servedPlaybooksFields, ...searchedFields }),
      Schema.Struct({ ...serverFields, ...servedPlaybooksFields, ...unavailableFields }),
    ]),
  ).annotate({
    description:
      'The tool servers searched, of the org or of the playbook asked for, sorted by name; empty when none is set up',
  }),
  ...foundFields,
  providers: Schema.optionalKey(
    Schema.Array(FoundProviderSchema).annotate({
      description:
        'The providers this caller may connect here that no server of the org serves yet, best first with terms and by name without; at most 100, and none without terms when there are more. Present only where this caller may add a connection, and never with server',
    }),
  ),
});

export type Found = typeof FoundSchema.Type;

export type OrgFound = typeof OrgFoundSchema.Type;

export type FoundTool = typeof FoundToolSchema.Type;

export type SearchedServer = Found['servers'][number];

export type OrgSearchedServer = OrgFound['servers'][number];

export type SearchAsked = typeof SearchInputSchema.Type;

export type OrgSearchAsked = typeof OrgSearchInputSchema.Type;
