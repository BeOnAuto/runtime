import {
  plainTextIn,
  technicalTextIn,
  toolNamesIn,
  withMcpSession,
  type McpSession,
  type ToolResult,
} from '@on.auto/api/testing';
import { internalTermsIn } from '@on.auto/operations/testing';
import { ModelNotAllowed, ProviderNotConfigured, DefinitionInvalid } from '@on.auto/reasoning';
import { answers, textResult, type ScriptedReply } from '@on.auto/reasoning/testing';
import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { interactionsCalled } from '../testing/interaction-servers/interaction-calls.ts';
import { servingWithAToolServer, toolServerToolsCalled } from '../testing/servers/tool-server-calls.ts';
import { servingWorkflows, workflowSource } from '../testing/servers/workflow-server.ts';

type Called = readonly (readonly [string, ToolResult])[];

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'description: Summarizes a text',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  'Summarize: {{ input.text }}',
].join('\n');

const approval = workflowSource(
  'approval',
  `do:
  - decide:
      listen:
        to:
          one:
            with: { type: com.acme.approval.decided }
`,
);

const unconnectedRun = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const replies: readonly ScriptedReply[] = [
  answers(textResult('Profits rose.')),
  () =>
    Effect.fail(
      new ProviderNotConfigured({
        detail: 'anthropic is not configured; it needs ANTHROPIC_API_KEY',
        provider: 'anthropic',
        configured: [],
        missing: ['ANTHROPIC_API_KEY'],
      }),
    ),
  () =>
    Effect.fail(
      new DefinitionInvalid({
        detail: 'anthropic answered HTTP 400',
        provider: 'anthropic',
        status: 400,
        provider_message: 'temperature is not supported',
        issues: [],
      }),
    ),
];

const disallowedModel = new ModelNotAllowed({
  detail: 'anthropic/claude-sonnet-4-5 is not one of the models this server offers',
  provider: 'anthropic',
});

const switchable =
  'Nothing was changed. This can be put right on your side: once its prompt names one of the models this server can call, which list_models shows, it can be tried again.';

function executedOnce(): Promise<ToolResult> {
  const reasonFunction = { type: 'reasoning', name: 'summary' };
  return onMcp(async (session) => {
    await session.callTool('create_playbook', { playbook: 'sales', name: 'Sales' });
    await session.callTool('create_definition', inSales({ ...reasonFunction, source: summary }));
    return session.callTool('run_definition', inSales({ ...reasonFunction, input: { text: 'the quarter' } }));
  });
}

const unofferedProvider = new ProviderNotConfigured({
  detail: 'anthropic is not configured. Configured providers: openai, gateway',
  provider: 'anthropic',
  configured: ['openai', 'gateway'],
  missing: ['ANTHROPIC_API_KEY'],
});

let server: Awaited<ReturnType<typeof servingWorkflows>>;

afterEach(async () => {
  await server.stop();
});

function onMcp<T>(
  use: (session: McpSession) => Promise<T>,
  headers: Readonly<Record<string, string>> = {},
): Promise<T> {
  return withMcpSession('current revision', { url: `${server.origin}/mcp`, headers }, use);
}

const inSales = (input: Readonly<Record<string, unknown>>) => ({ playbook: 'sales', ...input });

async function playbooksCalled(session: McpSession): Promise<Called> {
  const describing = { playbook: 'sales', name: 'Sales', description: 'Answers questions about the pipeline' };
  const created = await session.callTool('create_playbook', describing);
  await session.callTool('create_playbook', { playbook: 'old-sales', name: 'Old sales' });
  return [
    ['create_playbook', created],
    ['retire_playbook', await session.callTool('retire_playbook', { playbook: 'old-sales' })],
    ['list_playbooks', await session.callTool('list_playbooks', { include_retired: true })],
    ['update_playbook', await session.callTool('update_playbook', { ...describing, description: 'Answers questions' })],
    ['list_models', await session.callTool('list_models', {})],
  ];
}

const EventsSchema = Schema.Struct({ events: Schema.NonEmptyArray(Schema.Struct({ id: Schema.String })) });

function firstEventIn({ structuredContent }: ToolResult): string {
  return Schema.decodeUnknownSync(EventsSchema)(structuredContent).events[0].id;
}

async function reasonFunctionsCalled(session: McpSession): Promise<Called> {
  const reasonFunction = { type: 'reasoning', name: 'summary' };
  const created = await session.callTool('create_definition', inSales({ ...reasonFunction, source: summary }));
  const ran = await session.callTool('run_definition', inSales({ ...reasonFunction, input: { text: 'the quarter' } }));
  const runId = String(ran.structuredContent?.['run_id']);
  const revised = summary.replace('Summarize: ', 'Sum up: ');
  const listed = await session.callTool('list_playbook_events', inSales({ limit: 3 }));
  return [
    ['create_definition', created],
    ['list_definitions', await session.callTool('list_definitions', inSales({ type: 'reasoning' }))],
    ['get_definition', await session.callTool('get_definition', inSales(reasonFunction))],
    ['update_definition', await session.callTool('update_definition', inSales({ ...reasonFunction, source: revised }))],
    ['run_definition', ran],
    ['get_run', await session.callTool('get_run', inSales({ run_id: runId }))],
    ['list_runs', await session.callTool('list_runs', inSales({}))],
    [
      'publish_event',
      await session.callTool('publish_event', inSales({ event: { source: '/crm', type: 'com.acme.deal.won' } })),
    ],
    ['list_playbook_events', listed],
    ['get_event', await session.callTool('get_event', inSales({ event_id: firstEventIn(listed) }))],
    ['list_playbook_events', await session.callTool('list_playbook_events', { playbook: 'old-sales' })],
  ];
}

async function workflowsCalled(session: McpSession): Promise<Called> {
  const workflow = { type: 'workflow', name: 'approval' };
  await session.callTool('create_definition', inSales({ ...workflow, source: approval }));
  const started = await session.callTool('run_definition', inSales(workflow));
  const runId = String(started.structuredContent?.['run_id']);
  const event = { type: 'com.acme.approval.decided', data: 'yes' };
  return [
    ['run_definition', started],
    ['get_run', await session.callTool('get_run', inSales({ run_id: runId }))],
    ['send_run_event', await session.callTool('send_run_event', inSales({ run_id: runId, event }))],
    ['cancel_run', await cancelled(session, await session.callTool('run_definition', inSales(workflow)))],
    ['retire_definition', await session.callTool('retire_definition', inSales(workflow))],
  ];
}

function cancelled(session: McpSession, { structuredContent }: ToolResult): Promise<ToolResult> {
  return session.callTool('cancel_run', inSales({ run_id: String(structuredContent?.['run_id']) }));
}

async function errorsCalled(session: McpSession): Promise<Called> {
  const run = (input: Readonly<Record<string, unknown>>) =>
    session.callTool('run_definition', inSales({ type: 'reasoning', name: 'summary', ...input }));
  const broken = { type: 'reasoning', name: 'broken', source: '---\nmodel: [\n---\nHi' };
  const retired = { type: 'workflow', name: 'approval', source: approval };
  return [
    ['an unconnected provider', await run({ input: { text: 'the quarter' }, run_id: unconnectedRun })],
    ['a document the provider refuses', await run({ input: { text: 'the year' } })],
    ['an unexpected failure', await run({ input: { text: 'the decade' } })],
    ['input that does not fit', await run({ input: { text: 7 } })],
    ['a document that does not parse', await session.callTool('create_definition', inSales(broken))],
    ['a name already taken', await session.callTool('create_playbook', { playbook: 'sales', name: 'Sales again' })],
    ['a retired thing', await session.callTool('update_definition', inSales(retired))],
    [
      'a retired playbook',
      await session.callTool('create_definition', {
        playbook: 'old-sales',
        type: 'reasoning',
        name: 'summary',
        source: summary,
      }),
    ],
    ['something missing', await session.callTool('get_definition', inSales({ type: 'reasoning', name: 'nowhere' }))],
    ['a run that did not go through', await session.callTool('get_run', inSales({ run_id: unconnectedRun }))],
  ];
}

const referenceOf = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ instance: Schema.optionalKey(Schema.String) })),
);

function plainWordsBesideTheReference(result: ToolResult): string {
  const { instance } = referenceOf(technicalTextIn(result));
  const words = plainTextIn(result);
  return instance === undefined ? words : words.replace(instance.replace('urn:uuid:', ''), 'the reference');
}

function leaked([label, result]: readonly [string, ToolResult]): readonly (readonly [string, readonly string[]])[] {
  const terms = internalTermsIn(plainWordsBesideTheReference(result));
  return terms.length === 0 ? [] : [[label, terms]];
}

function audienceOf([label, result]: readonly [string, ToolResult]): readonly [string, boolean] {
  return [label, plainTextIn(result).includes(audienceWords[label] ?? 'no words for this label')];
}

const audienceWords: Readonly<Record<string, string>> = {
  'an unconnected provider': 'Only whoever runs the server can put this right',
  'a document the provider refuses': 'This can be corrected and tried again',
  'an unexpected failure': 'It was not caused by anything you did.',
  'input that does not fit': 'This can be corrected and tried again',
  'a document that does not parse': 'This can be corrected and tried again',
  'a name already taken': 'that name is already taken',
  'a retired thing': 'it has been retired',
  'a retired playbook': 'it has been retired',
  'something missing': 'it, or something it refers to, could not be found',
  'a run that did not go through': 'did not go through: something the server relies on is not available',
};

describe('the plain words that lead each result over MCP', () => {
  it('lead every tool’s success and every kind of error, name no internal term, and come before the details', async () => {
    server = await servingWithAToolServer(replies);

    const { tools, successes, errors } = await onMcp(async (session) => ({
      tools: toolNamesIn(await session.listTools()).filter((name) => name !== 'get_guide'),
      successes: [
        ...(await playbooksCalled(session)),
        ...(await reasonFunctionsCalled(session)),
        ...(await workflowsCalled(session)),
        ...(await interactionsCalled(session, inSales)),
        ...(await toolServerToolsCalled(session, inSales)),
      ],
      errors: await errorsCalled(session),
    }));
    const everyResult = [...successes, ...errors];

    expect(new Set(successes.map(([name]) => name))).toEqual(new Set(tools));
    expect(successes.filter(([, result]) => result.isError === true)).toEqual([]);
    expect(errors.map((called) => audienceOf(called))).toEqual(errors.map(([label]) => [label, true]));
    expect(everyResult.flatMap((called) => leaked(called))).toEqual([]);
    expect(everyResult.map(([, result]) => result.content.length)).toEqual(everyResult.map(() => 2));
  });
});

describe('the plain words for a reasoning function whose prompt names a model the server does not offer', () => {
  it('say that its provider is not set up while others are, and that it can be switched to a model the server lists', async () => {
    server = await servingWorkflows([() => Effect.fail(unofferedProvider)]);

    const unoffered = await executedOnce();

    expect(plainTextIn(unoffered)).toBe(
      `Could not run the reasoning function “summary”: this server does not offer the model named, because its provider is not set up on this server, though others are. ${switchable}`,
    );
    expect(internalTermsIn(plainTextIn(unoffered))).toEqual([]);
    expect(technicalTextIn(unoffered)).toContain('Configured providers: openai, gateway');
  });

  it('say that it is outside the models whoever runs the server allows, and that it can be switched', async () => {
    server = await servingWorkflows([() => Effect.fail(disallowedModel)]);

    const disallowed = await executedOnce();

    expect(plainTextIn(disallowed)).toBe(
      `Could not run the reasoning function “summary”: this server does not offer the model named, because it is not among the models whoever runs the server allows. ${switchable}`,
    );
    expect(internalTermsIn(plainTextIn(disallowed))).toEqual([]);
    expect(technicalTextIn(disallowed)).toContain('is not one of the models this server offers');
    expect(technicalTextIn(disallowed)).not.toContain('gateway/*');
  });
});
