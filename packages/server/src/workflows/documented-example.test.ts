import { answers, textResult, type ScriptedReply } from '@on.auto/reasoning/testing';
import { serveFakeMcp, type FakeMcpServer, type FakeTool } from '@on.auto/tool-servers/served-fakes';
import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { chatEnvironment, chatServer, chatKey } from '../testing/interaction-servers/chat-deliveries.ts';
import type { TestResponse } from '../testing/servers/http-client.ts';
import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { blocksInOrderOf, fencedBlocksOf, pageOf } from '../testing/servers/tutorial-calls.ts';
import {
  createdWithGoals,
  runIdIn,
  servingReasoningWithGoals,
  servingWorkflows,
  settledRun,
  workflowSource,
} from '../testing/servers/workflow-server.ts';
import { whenHeld } from '../testing/waiting/until.ts';

const workflowFormatBlocks = blocksInOrderOf('reference/workflow-format.md').map(({ body }) => body);

const [reviewAndApprove, reviewCampaignBrief] = workflowFormatBlocks;

const readingEachDocument = String(workflowFormatBlocks.find((body) => body.includes('name: read-document')));

const approveCampaignBrief = fencedBlocksOf('reference/interaction-format.md').get('markdown');

const decodeListed = Schema.decodeUnknownSync(
  Schema.Struct({ interactions: Schema.Array(Schema.Struct({ run_id: Schema.String })) }),
);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

const briefsReady = [
  '- id: briefs-ready',
  '  statement: Each campaign brief is reviewed and approved before launch.',
  '  success:',
  '    label: Briefs approved',
  '    settles: on_crossing',
  '    target: { at_least: 0 }',
  '    passed: Briefs approved',
  '    failed: Briefs held up',
  '  notify: { passed: quiet, failed: quiet }',
  '',
].join('\n');

const glancedAfterOneApproval = {
  headline: 'Owners approved 1 of the 1 brief reviewed so far.',
  visual: {
    kind: 'figures',
    items: [
      { name: 'Approved', value: 1 },
      { name: 'Sent back', value: 0 },
    ],
  },
  outstanding: [],
};

function reviewAndApproveOnceGlanced(): Promise<unknown> {
  return whenHeld(
    async () => (await server.call('GET', `${alpha}/definitions/workflow/review-and-approve`)).body,
    (definition) => JSON.stringify(definition).includes('"folded":1'),
  );
}

describe('the example of the workflow format, through the server', () => {
  it('saves the functions the page shows and names, and the workflow with what it contributes to the goal the page names, reviews the brief, asks its owner in the chat, and ends with the review and the approval its page heads the run with', async () => {
    const chat = await chatServer();
    server = await servingReasoningWithGoals(
      [answers(textResult('Revise: the audience lacks a job role.'))],
      chatEnvironment(chat.url),
    );
    await createdWithGoals(server, { goals: briefsReady });
    await server.call('POST', `${alpha}/definitions/reasoning`, {
      body: { name: 'review-campaign-brief', source: reviewCampaignBrief, diagram: 'none' },
    });
    await server.call('POST', `${alpha}/definitions/interaction`, {
      body: { name: 'approve-campaign-brief', source: approveCampaignBrief, diagram: 'none' },
    });

    const created = await server.call('POST', `${alpha}/definitions/workflow`, {
      body: { name: 'review-and-approve', source: reviewAndApprove },
    });
    const started = await server.call('POST', `${alpha}/definitions/workflow/review-and-approve/run`, {
      body: { input: { brief: 'Spring sale for returning customers.', owner: 'ada@example.com' } },
    });
    const [request] = await whenHeld(
      async () => decodeListed((await server.call('GET', `${alpha}/interactions`)).body).interactions,
      (interactions) => interactions.length > 0,
    );
    const approval = { verdict: 'approve', note: 'Approved for the spring sale.' };
    await server.call('POST', `${alpha}/runs/${String(request?.run_id)}/answer`, { body: { answer: approval } });

    expect(pageOf('reference/workflow-format.md')).toContain(
      '`approve-campaign-brief` is the example of the [interaction function format](interaction-format.md#a-function-document)',
    );
    expect(pageOf('reference/workflow-format.md')).toContain('whose goal `briefs-ready` is that');
    expect(created).toMatchObject({ status: 201, body: { details: { contributes: [{ goal: 'briefs-ready' }] } } });
    expect(await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`)).toMatchObject({
      body: {
        status: 'succeeded',
        output: { review: 'Revise: the audience lacks a job role.', approval },
        page: { result: 'Approved by the owner. Approved for the spring sale.' },
      },
    });
    expect(await reviewAndApproveOnceGlanced()).toMatchObject({ page: { glance: glancedAfterOneApproval } });
  });
});

interface FolderDocument {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}

const folderDocuments: readonly FolderDocument[] = [
  { id: 'doc-1', title: 'Spring plan', text: 'Opens two counters in March.' },
  { id: 'doc-2', title: 'Spring budget', text: 'Spends 4,000 on fittings.' },
];

function structured(content: Schema.Json): ReturnType<FakeTool['answer']> {
  return { content: [{ type: 'text', text: JSON.stringify(content) }], structuredContent: content };
}

function argumentOf(input: unknown, name: string): unknown {
  return Reflect.get(new Object(input), name);
}

function idsIn(folder: unknown): readonly string[] {
  return folder === 'empty' ? [] : folderDocuments.map((document) => document.id);
}

function documentOf(id: unknown): Schema.Json {
  const found = folderDocuments.find((document) => document.id === id);
  return found === undefined ? null : { ...found };
}

const documentTools: readonly FakeTool[] = [
  {
    name: 'list_documents',
    inputSchema: { type: 'object', properties: { folder: { type: 'string' } }, required: ['folder'] },
    annotations: { readOnlyHint: true },
    answer: (input) => structured({ ids: idsIn(argumentOf(input, 'folder')) }),
  },
  {
    name: 'read_document',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { readOnlyHint: true },
    answer: (input) => structured(documentOf(argumentOf(input, 'id'))),
  },
];

function lookupOf(tool: string, argument: string, read: readonly string[], output: string): string {
  return [
    '---',
    'call:',
    '  server: documents',
    `  tool: ${tool}`,
    `  with: { ${argument}: '{{ input.${argument} }}' }`,
    ...read,
    'input:',
    `  schema: { type: object, required: [${argument}], properties: { ${argument}: { type: string } } }`,
    'output:',
    `  schema: ${output}`,
    '---',
  ].join('\n');
}

const reviewDocuments = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: { type: object, required: [documents], properties: { documents: { type: array } } }',
  '---',
  'Review these documents together: {{ input.documents | json }}',
].join('\n');

interface Reviewed {
  readonly tools: unknown;
  readonly messages: string;
}

interface Folder {
  readonly serving: ReasoningServer;
  readonly fake: FakeMcpServer;
  readonly reviewed: () => readonly Reviewed[];
}

async function servingAFolder(): Promise<Folder> {
  const reviewed: Reviewed[] = [];
  const fake = await serveFakeMcp({ bearer: chatKey, tools: documentTools });
  onTestFinished(fake.close);
  const reviewing: ScriptedReply = (request) => {
    reviewed.push({ tools: request.tools, messages: JSON.stringify(request.messages) });
    return Effect.succeed(textResult('Both documents agree.'));
  };
  const documents = { url: fake.url, headers: { Authorization: 'Bearer ${CHAT_KEY}' }, org: 'acme' };
  const serving = await servingWorkflows([reviewing, reviewing], {
    CHAT_KEY: chatKey,
    TOOL_SERVERS: JSON.stringify({ documents }),
  });
  await serving.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  return { serving, fake, reviewed: () => [...reviewed] };
}

function savedDefinitions(serving: ReasoningServer): Promise<readonly TestResponse[]> {
  const listing = lookupOf('list_documents', 'folder', ['  read: /ids'], '{ type: array, items: { type: string } }');
  return Promise.all([
    serving.call('POST', `${alpha}/definitions/lookup`, {
      body: { name: 'list-documents', source: listing, diagram: 'none' },
    }),
    serving.call('POST', `${alpha}/definitions/lookup`, {
      body: { name: 'read-document', source: lookupOf('read_document', 'id', [], '{ type: object }'), diagram: 'none' },
    }),
    serving.call('POST', `${alpha}/definitions/reasoning`, {
      body: { name: 'review-documents', source: reviewDocuments, diagram: 'none' },
    }),
    serving.call('POST', `${alpha}/definitions/workflow`, {
      body: { name: 'review-folder', source: workflowSource('review-folder', readingEachDocument) },
    }),
  ]);
}

async function reviewedFolder(serving: ReasoningServer, folder: string): Promise<TestResponse> {
  const started = await serving.call('POST', `${alpha}/definitions/workflow/review-folder/run`, {
    body: { input: { folder } },
  });
  return settledRun(serving, `${alpha}/runs/${runIdIn(started.body)}`);
}

describe('the example of a lookup for each item, through the server', () => {
  it('reads each document the step before it listed, one lookup run for each, and hands the reasoning function the list, without tools', async () => {
    const { serving, fake, reviewed } = await servingAFolder();
    server = serving;
    const saved = await savedDefinitions(server);

    const ended = [await reviewedFolder(server, 'spring'), await reviewedFolder(server, 'empty')];

    expect(saved.map(({ status }) => status)).toEqual([201, 201, 201, 201]);
    expect(ended.map(({ body }) => body)).toMatchObject([
      { status: 'succeeded', output: 'Both documents agree.' },
      { status: 'succeeded', output: 'Both documents agree.' },
    ]);
    expect(
      reviewed().map(({ tools, messages }) => ({
        tools,
        every: messages.includes(JSON.stringify(JSON.stringify(folderDocuments)).slice(1, -1)),
        none: messages.includes('Review these documents together: []'),
      })),
    ).toEqual([
      { tools: undefined, every: true, none: false },
      { tools: undefined, every: false, none: true },
    ]);
    expect(fake.received().map(({ tool, arguments: sent }) => ({ tool, sent }))).toEqual([
      { tool: 'list_documents', sent: { folder: 'spring' } },
      { tool: 'read_document', sent: { id: 'doc-1' } },
      { tool: 'read_document', sent: { id: 'doc-2' } },
      { tool: 'list_documents', sent: { folder: 'empty' } },
    ]);
  });
});
