import { Schema } from 'effect';

import { shownEndpoints, type ShownEndpoint } from '../../debug/agent-surface.ts';
import { instructionsActingAs, instructionsFor, type ActingAs, type ServedTools } from '../../mcp/instructions.ts';
import { plainTextIn, textOf, withMcpSession, type McpSession } from '../mcp-clients.ts';
import { guideToolName } from '../tool-listing.ts';

export interface FirstCall {
  readonly tool: string;
  readonly arguments: Readonly<Record<string, string>>;
}

export interface Reading {
  readonly origin: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly org: string;
  readonly playbook: string;
  readonly actingAs: ActingAs;
  readonly firstCalls: readonly FirstCall[];
}

interface PromptArgument {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
}

export type PromptMessage =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'attached'; readonly uri: string; readonly text: string };

export interface ServedPrompt {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly arguments: readonly PromptArgument[];
  readonly messages: readonly PromptMessage[];
}

export interface ServedGuide {
  readonly name: string;
  readonly text: string;
}

export interface ServedTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface ServedConnection extends Pick<ShownEndpoint, 'endpoint' | 'path'> {
  readonly instructions: string;
  readonly listing: readonly unknown[];
  readonly tools: readonly ServedTool[];
  readonly prompts: readonly ServedPrompt[];
  readonly guides: readonly ServedGuide[];
}

export interface ServedAnswer extends FirstCall {
  readonly path: string;
  readonly text: string;
}

export interface ServedSurface {
  readonly connections: readonly ServedConnection[];
  readonly answers: readonly ServedAnswer[];
}

export const originPlaceholder = '{origin}';

const ListingSchema = Schema.Struct({ tools: Schema.Array(Schema.Unknown) });

const ToolSchema = Schema.Struct({
  name: Schema.String,
  title: Schema.String,
  description: Schema.String,
  inputSchema: Schema.Record(Schema.String, Schema.Unknown),
});

const PromptsSchema = Schema.Struct({
  prompts: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      title: Schema.String,
      description: Schema.String,
      arguments: Schema.Array(
        Schema.Struct({ name: Schema.String, description: Schema.String, required: Schema.Boolean }),
      ),
    }),
  ),
});

const PromptAnswerSchema = Schema.Struct({
  messages: Schema.Array(
    Schema.Struct({
      content: Schema.Union([
        Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
        Schema.Struct({
          type: Schema.Literal('resource'),
          resource: Schema.Struct({ uri: Schema.String, text: Schema.String }),
        }),
      ]),
    }),
  ),
});

const GuideChoicesSchema = Schema.Struct({
  properties: Schema.Struct({ guide: Schema.Struct({ enum: Schema.Array(Schema.String) }) }),
});

type ListedPrompt = (typeof PromptsSchema.Type)['prompts'][number];

type AnsweredMessage = (typeof PromptAnswerSchema.Type)['messages'][number];

function addressOf(path: string, { origin, org, playbook }: Reading): string {
  return `${origin}${path.replace('{org}', org).replace('{playbook}', playbook)}`;
}

function onEndpoint<T>(reading: Reading, path: string, use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession('current revision', { url: addressOf(path, reading), headers: reading.headers }, use);
}

function servedToolsOf(tools: readonly ServedTool[]): ServedTools {
  return { orgTools: tools.map(({ name }) => name), playbookTools: [] };
}

function instructionsShownOf(
  served: string | undefined,
  { endpoint, path }: ShownEndpoint,
  tools: readonly ServedTool[],
  actingAs: ActingAs,
): string {
  if (served !== instructionsActingAs(actingAs, endpoint, servedToolsOf(tools))) {
    throw new Error(`The instructions served on ${path} are not the ones /debug shows with the caller's sentence`);
  }
  return instructionsFor(endpoint, servedToolsOf(tools));
}

function placeholdersFor(listed: ListedPrompt): Readonly<Record<string, string>> {
  return Object.fromEntries(listed.arguments.filter(({ required }) => required).map(({ name }) => [name, `{${name}}`]));
}

function messageOf({ content }: AnsweredMessage): PromptMessage {
  return content.type === 'text'
    ? { kind: 'text', text: content.text }
    : { kind: 'attached', uri: content.resource.uri, text: content.resource.text };
}

async function promptOf(session: McpSession, listed: ListedPrompt): Promise<ServedPrompt> {
  const answered = Schema.decodeUnknownSync(PromptAnswerSchema)(
    await session.getPrompt(listed.name, placeholdersFor(listed)),
  );
  return { ...listed, messages: answered.messages.map((message) => messageOf(message)) };
}

async function promptsOf(session: McpSession): Promise<readonly ServedPrompt[]> {
  const { prompts } = Schema.decodeUnknownSync(PromptsSchema)(await session.listPrompts());
  return Promise.all(prompts.map((listed) => promptOf(session, listed)));
}

function guideNamesIn(tools: readonly ServedTool[]): readonly string[] {
  return tools
    .filter(({ name }) => name === guideToolName)
    .flatMap(({ inputSchema }) => Schema.decodeUnknownSync(GuideChoicesSchema)(inputSchema).properties.guide.enum);
}

function guidesOf(session: McpSession, tools: readonly ServedTool[]): Promise<readonly ServedGuide[]> {
  return Promise.all(
    guideNamesIn(tools).map(async (name) => ({
      name,
      text: textOf(await session.callTool(guideToolName, { guide: name })),
    })),
  );
}

function connectionRead(reading: Reading, shown: ShownEndpoint): Promise<ServedConnection> {
  return onEndpoint(reading, shown.path, async (session) => {
    const { tools: listing } = Schema.decodeUnknownSync(ListingSchema)(await session.listTools());
    const tools = listing.map((tool) => Schema.decodeUnknownSync(ToolSchema)(tool));
    return {
      endpoint: shown.endpoint,
      path: shown.path,
      instructions: instructionsShownOf(session.instructions, shown, tools, reading.actingAs),
      listing,
      tools,
      prompts: await promptsOf(session),
      guides: await guidesOf(session, tools),
    };
  });
}

function withoutTheOrigin(text: string, origin: string): string {
  return text
    .replaceAll(origin, originPlaceholder)
    .replaceAll(encodeURIComponent(origin), encodeURIComponent(originPlaceholder));
}

function answersRead(reading: Reading, { path }: ShownEndpoint): Promise<readonly ServedAnswer[]> {
  return onEndpoint(reading, path, (session) =>
    reading.firstCalls.reduce(async (before: Promise<readonly ServedAnswer[]>, call) => {
      const answers = await before;
      const answered = plainTextIn(await session.callTool(call.tool, call.arguments));
      return [...answers, { ...call, path, text: withoutTheOrigin(answered, reading.origin) }];
    }, Promise.resolve([])),
  );
}

export async function servedSurfaceAt(reading: Reading): Promise<ServedSurface> {
  const answers = await Promise.all(shownEndpoints.slice(0, 1).map((first) => answersRead(reading, first)));
  const connections = await Promise.all(shownEndpoints.map((shown) => connectionRead(reading, shown)));
  return { connections, answers: answers.flat() };
}
