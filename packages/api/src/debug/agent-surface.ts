import type { GetPromptResult } from '@modelcontextprotocol/server';
import type { Catalog } from '@on.auto/operations';

import type { Guide, GuideShelf, RecipeArgument, RecipeWords } from '../guides/guide-shelf.ts';
import { recipeAnswerOf } from '../guides/recipe-prompts.ts';
import { startingAnswerOf, startingPromptsFollowedWith } from '../guides/starting-prompts.ts';
import { instructionsFor, recipesFollowedWith, type McpEndpoint } from '../mcp/instructions.ts';
import { connectionListingOf, type EveryTool, type ServerInfo } from '../mcp/mcp-connection.ts';
import type { DirectoryListingServing } from '../mcp/mcp-routes.ts';
import { listingsOf } from '../mcp/mcp-server-factory.ts';
import { shownToolOf, toolGroupsOf, type ToolGroup } from './shown-tools.ts';

export interface DebugServing {
  readonly catalog: Catalog;
  readonly shelf: GuideShelf;
  readonly serverInfo: ServerInfo;
  readonly directoryListing?: DirectoryListingServing;
}

export interface ShownPrompt {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly arguments: readonly RecipeArgument[];
  readonly texts: readonly string[];
  readonly attached: readonly string[];
}

export interface SurfaceConnection {
  readonly key: string;
  readonly prefix: string;
  readonly label: string;
  readonly path: string;
  readonly instructions: string;
  readonly toolCount: number;
  readonly groups: readonly ToolGroup[];
  readonly guides: readonly Guide[];
  readonly prompts: readonly ShownPrompt[];
}

export interface SurfaceShelf {
  readonly prefix: string;
  readonly connections: readonly string[];
  readonly guides: readonly Guide[];
}

export interface AgentSurface {
  readonly serverInfo: ServerInfo;
  readonly connections: readonly SurfaceConnection[];
  readonly shelves: readonly SurfaceShelf[];
}

export interface ShownEndpoint {
  readonly endpoint: McpEndpoint;
  readonly key: string;
  readonly prefix: string;
  readonly label: string;
  readonly path: string;
}

export const shownEndpoints: readonly ShownEndpoint[] = [
  { endpoint: 'own org', key: 'mcp', prefix: '', label: 'Your organization', path: '/mcp' },
  { endpoint: 'org', key: 'org', prefix: 'org-', label: 'An organization', path: '/orgs/{org}/mcp' },
  {
    endpoint: 'playbook',
    key: 'playbook',
    prefix: 'playbook-',
    label: 'A playbook',
    path: '/orgs/{org}/playbooks/{playbook}/mcp',
  },
  { endpoint: 'directory', key: 'directory', prefix: 'directory-', label: 'Directory listing', path: '/directory' },
];

function placeholdersFor(given: readonly RecipeArgument[]): RecipeWords {
  return Object.fromEntries(given.filter(({ required }) => required).map(({ name }) => [name, `{${name}}`]));
}

interface Promptable {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly arguments: readonly RecipeArgument[];
}

function shownPromptOf(prompt: Promptable, answer: (words: RecipeWords) => GetPromptResult): ShownPrompt {
  const texts: string[] = [];
  const attached: string[] = [];
  for (const { content } of answer(placeholdersFor(prompt.arguments)).messages) {
    if (content.type === 'text') {
      texts.push(content.text);
    }
    if (content.type === 'resource') {
      attached.push(content.resource.uri);
    }
  }
  const { name, title, description } = prompt;
  return { name, title, description, arguments: prompt.arguments, texts, attached };
}

function promptsOf(shelf: GuideShelf, { served }: EveryTool): readonly ShownPrompt[] {
  return [
    ...startingPromptsFollowedWith(served).map((prompt) => shownPromptOf(prompt, startingAnswerOf(prompt))),
    ...recipesFollowedWith(served, shelf.recipes).map((recipe) => shownPromptOf(recipe, recipeAnswerOf(recipe))),
  ];
}

function connectionOf({ endpoint, ...named }: ShownEndpoint, shelf: GuideShelf, every: EveryTool): SurfaceConnection {
  const tools = connectionListingOf(shelf, every).map((tool) => shownToolOf(tool));
  return {
    ...named,
    instructions: instructionsFor(endpoint, every.served),
    toolCount: tools.length,
    groups: toolGroupsOf(tools),
    guides: shelf.everyGuide,
    prompts: promptsOf(shelf, every),
  };
}

type Served = readonly (readonly [ShownEndpoint, GuideShelf])[];

function shelvesOf(served: Served): readonly SurfaceShelf[] {
  const firstOnEachShelf = served.filter(
    ([, shelf], index) => served.findIndex(([, other]) => other === shelf) === index,
  );
  return firstOnEachShelf.map(([{ prefix }, shelf]) => ({
    prefix,
    connections: served.filter(([, other]) => other === shelf).map(([{ key }]) => key),
    guides: shelf.everyGuide,
  }));
}

export function agentSurfaceOf({ catalog, shelf, serverInfo, directoryListing }: DebugServing): AgentSurface {
  const directory = { catalog, shelf, ...directoryListing };
  const listings = listingsOf({ catalog }, directory);
  const served: Served = shownEndpoints.map((endpoint) => [
    endpoint,
    endpoint.endpoint === 'directory' ? directory.shelf : shelf,
  ]);
  return {
    serverInfo,
    connections: served.map(([endpoint, on]) => connectionOf(endpoint, on, listings[endpoint.endpoint])),
    shelves: shelvesOf(served),
  };
}
