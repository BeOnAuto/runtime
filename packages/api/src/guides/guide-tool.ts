import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { rejected, type Issue } from '@on.auto/operations';
import { Result, Schema, SchemaIssue, type SchemaAST } from 'effect';

import type { ToolDefinition } from '../tools/tool-definition.ts';
import { unsuccessfulResultOf } from '../tools/tool-result.ts';
import { advertisedSchema } from '../tools/tool-schema.ts';
import type { Guide, GuideShelf } from './guide-shelf.ts';

export const guideToolName = 'get_guide';

export const guideToolDescription = [
  "Reads one of the playbook's guides: what its words mean, how each kind of definition is written, with its format, examples and bounds, and how the common tasks are done.",
  'Read a format guide before writing that type of definition, the voice guide before writing an overview, and a recipe before its task.',
  '`guide` names one of them, and the answer is its whole text in Markdown.',
].join(' ');

type Followed = readonly Pick<Guide, 'name'>[];

function inTurn(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${String(items.at(-1))}`;
}

function descriptionFollowing(recipes: Followed): string {
  const names = recipes.map(({ name }) => name);
  if (names.length === 0) {
    return guideToolDescription;
  }
  const held = names.length === 1 ? 'the recipe' : 'the recipes';
  return `${guideToolDescription} It holds ${held} ${inTurn(names)}, which the tools listed here can follow.`;
}

export const guideArgumentDescription =
  'The guide to read: terminology, Auto voice, a definition format, or a recipe for a common task';

const strictly: SchemaAST.ParseOptions = { onExcessProperty: 'error', errors: 'all' };

const failureOf = SchemaIssue.makeFormatterStandardSchemaV1();

export function guideToolDefinitionOf({ everyGuide }: GuideShelf, followed: Followed): ToolDefinition {
  return {
    title: 'Get guide',
    description: descriptionFollowing(followed),
    inputSchema: advertisedSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        guide: { type: 'string', enum: everyGuide.map(({ name }) => name), description: guideArgumentDescription },
      },
      required: ['guide'],
      additionalProperties: false,
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  };
}

const decodeGuideInput = Schema.decodeUnknownResult(Schema.Struct({ guide: Schema.String }));

function pointerOf(path: readonly unknown[]): string {
  return path.map((segment) => `/${String(segment)}`).join('');
}

function refused(issues: readonly Issue[]): CallToolResult {
  return unsuccessfulResultOf(rejected('invalid_input', 'The input does not match the input schema', issues), false, {
    kind: 'query',
    attempt: 'read the guide',
  });
}

function guideReader({ named }: GuideShelf): (input: unknown) => CallToolResult {
  return (input) => {
    const decoded = decodeGuideInput(input, strictly);
    if (Result.isFailure(decoded)) {
      return refused(
        failureOf(decoded.failure.issue).issues.map(({ message, path = [] }) => ({
          detail: message,
          pointer: pointerOf(path),
        })),
      );
    }
    const guide = named(decoded.success.guide);
    return guide === undefined
      ? refused([{ detail: `There is no guide ${decoded.success.guide}`, pointer: '/guide' }])
      : { content: [{ type: 'text', text: guide.text }] };
  };
}

export function serveGuideTool(
  server: Readonly<Pick<McpServer, 'registerTool'>>,
  shelf: GuideShelf,
  followed: Followed,
): void {
  server.registerTool(guideToolName, guideToolDefinitionOf(shelf, followed), guideReader(shelf));
}
