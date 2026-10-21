import { McpServer } from '@modelcontextprotocol/server';
import type { Catalog, Dispatcher } from '@on.auto/operations';

import {
  mostInstructionCharacters,
  mostListingBytes,
  mostToolsOnAConnection,
  requireTextWithin,
  requireWithin,
} from '../bounds/served-bounds.ts';
import { serveGuides, type GuideRegistry } from '../guides/guide-serving.ts';
import type { GuideShelf } from '../guides/guide-shelf.ts';
import { guideToolDefinitionOf, guideToolName } from '../guides/guide-tool.ts';
import type { RunCall } from '../operations/operation-handler.ts';
import type { LinkedAnswers } from '../tools/linked-answers.ts';
import { listingBytesOf, type ListedTool } from '../tools/tool-listing.ts';
import { instructionsFor, recipesFollowedWith, type McpEndpoint, type ServedTools } from './instructions.ts';

export interface ServerInfo {
  readonly name: string;
  readonly version: string;
}

export interface McpServing {
  readonly catalog: Catalog;
  readonly dispatcher: Dispatcher;
  readonly runCall: RunCall;
  readonly serverInfo: ServerInfo;
  readonly shelf: GuideShelf;
}

export interface Connection {
  readonly endpoint: McpEndpoint;
  readonly serving: McpServing;
  readonly shelf: GuideShelf;
}

const noChangesAnnounced = { listChanged: false };

export const serverTitle = 'Auto Runtime';

function instructionsOf({ endpoint, shelf }: Connection, served: ServedTools): string {
  return instructionsFor(endpoint, served, shelf.definitionTypes);
}

export interface EveryTool {
  readonly served: ServedTools;
  readonly listed: readonly ListedTool[];
}

export function connectionOf(endpoint: McpEndpoint, serving: McpServing, { served, listed }: EveryTool): Connection {
  const connection = {
    endpoint,
    serving,
    shelf: serving.shelf,
  };
  const guideTool = guideToolDefinitionOf(connection.shelf, recipesFollowedWith(served, connection.shelf.recipes));
  const listing = [...listed, { name: guideToolName, definition: guideTool }];
  requireWithin(`The ${endpoint} endpoint`, listing.length, mostToolsOnAConnection, 'tools');
  requireWithin(
    `The listing of the ${endpoint} endpoint`,
    listingBytesOf(listing),
    mostListingBytes[endpoint],
    'bytes on the wire',
  );
  requireTextWithin(
    `The instructions of the ${endpoint} endpoint`,
    instructionsOf(connection, served),
    mostInstructionCharacters,
  );
  return connection;
}

export function serverOf(
  connection: Connection,
  served: ServedTools,
  states: LinkedAnswers['states'],
  registerTools: (server: GuideRegistry) => void,
): McpServer {
  const server = new McpServer(
    { ...connection.serving.serverInfo, title: serverTitle },
    {
      capabilities: { tools: noChangesAnnounced, resources: noChangesAnnounced, prompts: noChangesAnnounced },
      instructions: instructionsOf(connection, served),
      requestState: states,
    },
  );
  registerTools(server);
  serveGuides(server, connection.shelf, recipesFollowedWith(served, connection.shelf.recipes));
  return server;
}
