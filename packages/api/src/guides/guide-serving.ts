import type { McpServer } from '@modelcontextprotocol/server';

import { recipesFollowedWith, type ServedTools } from '../mcp/instructions.ts';
import { serveGuideResources } from './guide-resources.ts';
import type { GuideShelf } from './guide-shelf.ts';
import { serveGuideTool } from './guide-tool.ts';
import { serveRecipePrompts } from './recipe-prompts.ts';
import { serveStartingPrompts } from './starting-prompts.ts';

export type GuideRegistry = Readonly<Pick<McpServer, 'registerTool' | 'registerResource' | 'registerPrompt'>>;

export function serveGuides(server: GuideRegistry, shelf: GuideShelf, served: ServedTools): void {
  const recipes = recipesFollowedWith(served, shelf.recipes);
  serveGuideTool(server, shelf, recipes);
  serveGuideResources(server, shelf);
  serveStartingPrompts(server, served);
  serveRecipePrompts(server, recipes);
}
