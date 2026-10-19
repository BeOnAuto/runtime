import { Order, Predicate } from 'effect';

import { isReadOnly } from '../bounds/tool-results.ts';
import type { AvailableServer, ServerTool, ToolServer } from '../listing/tool-server.ts';
import type { Found, FoundTool, SearchAsked, SearchedServer } from './search-schemas.ts';
import { bestOf, summaryOf, wholeWithinTheBound, type Searchable } from './search-scoring.ts';

interface Candidate {
  readonly server: string;
  readonly tool: ServerTool;
}

const keptBy: Readonly<Record<NonNullable<SearchAsked['only']>, (tool: ServerTool) => boolean>> = {
  read: ({ annotations }) => isReadOnly(annotations),
  write: ({ annotations }) => !isReadOnly(annotations),
};

function consideredOn({ tools }: AvailableServer, { only }: SearchAsked): readonly ServerTool[] {
  return only === undefined ? tools : tools.filter((tool) => keptBy[only](tool));
}

export function searchedServer(server: ToolServer, asked: SearchAsked): SearchedServer {
  const { name, type, record_content, connection, provider } = server;
  const fields = { name, type, record_content, ...(connection === undefined ? {} : { connection }), provider };
  return 'unavailable' in server
    ? { ...fields, unavailable: server.unavailable, because: server.because }
    : { ...fields, tool_count: consideredOn(server, asked).length };
}

function candidatesOn(server: ToolServer, asked: SearchAsked): readonly Candidate[] {
  return 'unavailable' in server ? [] : consideredOn(server, asked).map((tool) => ({ server: server.name, tool }));
}

const byToolThenServer: Order.Order<Candidate> = Order.combine(
  Order.mapInput(Order.String, ({ tool }: Candidate) => tool.name),
  Order.mapInput(Order.String, ({ server }: Candidate) => server),
);

function searchableOf({ tool }: Candidate): Searchable {
  const { properties } = tool.input_schema;
  return {
    names: [tool.name],
    argumentNames: Predicate.isObject(properties) ? Object.keys(properties) : [],
    description: tool.description,
  };
}

function foundTool({ server, tool }: Candidate): FoundTool {
  return { server, tool: tool.name, summary: summaryOf(tool.description), read_only: isReadOnly(tool.annotations) };
}

export function foundIn(servers: readonly ToolServer[], asked: SearchAsked): Found {
  const candidates = servers.flatMap((server) => candidatesOn(server, asked));
  const chosen =
    asked.terms === undefined
      ? wholeWithinTheBound(candidates)
      : bestOf(candidates, asked.terms, searchableOf, byToolThenServer);
  return {
    servers: servers.map((server) => searchedServer(server, asked)),
    tools: chosen.map((candidate) => foundTool(candidate)),
    scopes: servers.map(({ name }) => name),
  };
}
