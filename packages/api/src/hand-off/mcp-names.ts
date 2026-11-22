import type { GuideShelf } from '../guides/guide-shelf.ts';
import { guideToolName } from '../guides/guide-tool.ts';
import { startingPromptsFollowedWith } from '../guides/starting-prompts.ts';
import { recipesFollowedWith } from '../mcp/instructions.ts';
import { connectionListingOf, type EveryTool } from '../mcp/mcp-connection.ts';
import { listedOf, type ListedTool } from '../tools/tool-listing.ts';
import type { McpNames, McpToolNamed } from './mcp-calls-noted.ts';

function argumentsDeclaredBy(tool: ListedTool): readonly string[] {
  const schema: object = listedOf(tool).inputSchema;
  const properties: unknown = 'properties' in schema ? schema.properties : undefined;
  return typeof properties === 'object' && properties !== null ? Object.keys(properties) : [];
}

export function mcpNamesOf(shelf: GuideShelf, every: EveryTool): McpNames {
  const tools = connectionListingOf(shelf, every).map((tool): readonly [string, McpToolNamed] => [
    tool.name,
    { operation: tool.name !== guideToolName, arguments: argumentsDeclaredBy(tool) },
  ]);
  const prompts = [
    ...startingPromptsFollowedWith(every.served, shelf),
    ...recipesFollowedWith(every.served, shelf.recipes),
  ].map(({ name }) => name);
  return {
    tools: new Map(tools),
    guides: new Set(shelf.everyGuide.map(({ name }) => name)),
    prompts: new Set(prompts),
  };
}
