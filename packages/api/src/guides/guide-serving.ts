import type { McpServer } from '@modelcontextprotocol/server';

import { serveGuideResources } from './guide-resources.ts';
import type { GuideShelf, ShelvedRecipe } from './guide-shelf.ts';
import { serveGuideTool } from './guide-tool.ts';
import { serveRecipePrompts } from './recipe-prompts.ts';

export type GuideRegistry = Readonly<Pick<McpServer, 'registerTool' | 'registerResource' | 'registerPrompt'>>;

export function serveGuides(server: GuideRegistry, shelf: GuideShelf, prompts: readonly ShelvedRecipe[]): void {
  serveGuideTool(server, shelf, prompts);
  serveGuideResources(server, shelf);
  serveRecipePrompts(server, prompts);
}
