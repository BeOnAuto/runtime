import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { text } from 'node:stream/consumers';

import { withMcpSession, type McpSession, type ToolResult } from '@on.auto/api/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { tcpPort } from '../lifecycle/http-server.ts';
import { developmentFiles, startDevelopment, untilListening } from '../testing/processes/development-process.ts';
import { until } from '../testing/waiting/until.ts';

const playbook = 'support';

const charged = 'I was charged twice for March and nobody has answered for three days.';

const question = 'How do I export my invoices as CSV?';

function classifyingPrompt(rules: string): string {
  return [
    '---',
    'model: stub/classifier',
    'description: Classifies a support ticket',
    'input:',
    '  schema: {type: object, properties: {ticket: {type: string}}, required: [ticket]}',
    'output:',
    '  format: json',
    '  schema:',
    '    type: object',
    '    properties:',
    '      category: {type: string, enum: [billing, bug, account, other]}',
    '      urgency: {type: string, enum: [low, normal, high]}',
    '    required: [category, urgency]',
    '    additionalProperties: false',
    '---',
    `{% system %}You triage support tickets. ${rules}{% endsystem %}`,
    'Ticket: {{ input.ticket }}',
  ].join('\n');
}

const escalationNote = [
  '---',
  'model: stub/writer',
  'description: Drafts an escalation note for the on-call lead',
  '---',
  'Write two sentences for the on-call lead about this {{ input.category }} ticket: {{ input.ticket }}',
].join('\n');

const triage = [
  "document: {dsl: '1.0.3', namespace: support, name: triage-ticket, version: '1.0.0'}",
  'do:',
  '  - classify:',
  '      call: run_definition',
  "      with: {type: reasoning, name: classify-ticket, input: {ticket: '${ $data.ticket }'}}",
  "      output: {as: '${ ({ ...$input, triage: $data }) }'}",
  '  - escalate:',
  '      if: $data.triage.urgency === "high"',
  '      call: run_definition',
  '      with:',
  '        type: reasoning',
  '        name: escalation-note',
  "        input: {ticket: '${ $data.ticket }', category: '${ $data.triage.category }'}",
  "      output: {as: '${ ({ ...$input, note: $data }) }'}",
].join('\n');

const approval = [
  "document: {dsl: '1.0.3', namespace: support, name: refund-approval, version: '1.0.0'}",
  'do:',
  '  - wait-for-manager:',
  '      listen: {to: {one: {with: {type: com.acme.refund.approved}}}}',
  "      output: {as: '${ ({ refund: $workflow.input.refund, approved_by: $data[0].by }) }'}",
].join('\n');

const escalationAnswer =
  'A customer was charged twice for March and has waited three days. Please refund and reply today.';

function answerTo(request: string): string {
  if (request.includes('on-call lead')) {
    return escalationAnswer;
  }
  const money = request.includes('charged');
  return JSON.stringify({ category: money ? 'billing' : 'other', urgency: money ? 'high' : 'low' });
}

async function answered(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const content = answerTo(await text(request));
  response.setHeader('content-type', 'application/json');
  response.end(
    JSON.stringify({
      id: 'chatcmpl-stub',
      object: 'chat.completion',
      created: 1_790_000_000,
      model: 'stub',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 64, completion_tokens: 16, total_tokens: 80 },
    }),
  );
}

async function stubGateway(): Promise<string> {
  const server = createServer((request, response) => {
    void answered(request, response);
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(() => {
    server.close();
  });
  return JSON.stringify([{ name: 'stub', base_url: `http://127.0.0.1:${tcpPort(server.address())}/v1` }]);
}

async function onPnpmDev<T>(use: (session: McpSession) => Promise<T>): Promise<T> {
  const development = startDevelopment(developmentFiles(), { environment: { MODEL_GATEWAYS: await stubGateway() } });
  const port = await untilListening(development);
  return withMcpSession('current revision', { url: `http://localhost:${port}/mcp`, headers: {} }, use);
}

function structured(result: ToolResult): Readonly<Record<string, unknown>> {
  return { isError: result.isError ?? false, ...result.structuredContent };
}

function settled(session: McpSession, runId: unknown): Promise<Readonly<Record<string, unknown>>> {
  return until(
    async () => structured(await session.callTool('get_run', { playbook, run_id: runId })),
    (reading) => reading['status'] !== 'started',
  );
}

async function stored(session: McpSession, type: string, name: string, source: string): Promise<unknown> {
  return structured(await session.callTool('create_definition', { playbook, type, name, source }));
}

async function ran(session: McpSession, name: string, input: object, type = 'reasoning'): Promise<unknown> {
  const started = structured(await session.callTool('run_definition', { playbook, type, name, input }));
  return settled(session, started['run_id']);
}

describe('the requests the quick start suggests, made over /mcp as an assistant would', () => {
  it('creates a playbook, stores a reasoning function that classifies tickets, runs it, reads its record and runs a new version', async () => {
    const steps = await onPnpmDev(async (session) => ({
      playbook: structured(await session.callTool('create_playbook', { playbook, name: 'Support' })),
      stored: await stored(session, 'reasoning', 'classify-ticket', classifyingPrompt('Answer as JSON.')),
      first: await ran(session, 'classify-ticket', { ticket: charged }),
      updated: structured(
        await session.callTool('update_definition', {
          playbook,
          type: 'reasoning',
          name: 'classify-ticket',
          source: classifyingPrompt('Anything about money is billing and at least normal urgency.'),
        }),
      ),
      second: await ran(session, 'classify-ticket', { ticket: charged }),
    }));

    expect(steps).toMatchObject({
      playbook: { isError: false, id: playbook, status: 'active' },
      stored: { isError: false, name: 'classify-ticket', version: 1 },
      first: {
        status: 'succeeded',
        output: { category: 'billing', urgency: 'high' },
        record: { usage: { total: 80 }, prompt: { message: `\nTicket: ${charged}` } },
      },
      updated: { isError: false, version: 2 },
      second: { status: 'succeeded', name: 'classify-ticket', definition_version: 2 },
    });
  });
});

describe('the workflow requests of the quick start, over /mcp', () => {
  it('builds a workflow that drafts an escalation note only for an urgent ticket, and runs it on two', async () => {
    const outputs = await onPnpmDev(async (session) => {
      await session.callTool('create_playbook', { playbook, name: 'Support' });
      await stored(session, 'reasoning', 'classify-ticket', classifyingPrompt('Answer as JSON.'));
      await stored(session, 'reasoning', 'escalation-note', escalationNote);
      await stored(session, 'workflow', 'triage-ticket', triage);
      return [
        await ran(session, 'triage-ticket', { ticket: charged }, 'workflow'),
        await ran(session, 'triage-ticket', { ticket: question }, 'workflow'),
      ];
    });

    expect(outputs).toMatchObject([
      { status: 'succeeded', output: { triage: { urgency: 'high' }, note: escalationAnswer } },
      { status: 'succeeded', output: { ticket: question, triage: { category: 'other', urgency: 'low' } } },
    ]);
  });

  it('starts a workflow that waits for an approval, sends the approval, and sees it finish', async () => {
    const ending = await onPnpmDev(async (session) => {
      await session.callTool('create_playbook', { playbook, name: 'Support' });
      await stored(session, 'workflow', 'refund-approval', approval);
      const started = structured(
        await session.callTool('run_definition', {
          playbook,
          type: 'workflow',
          name: 'refund-approval',
          input: { refund: 'ticket-4711' },
        }),
      );
      const sent = structured(
        await session.callTool('send_run_event', {
          playbook,
          run_id: started['run_id'],
          event: { type: 'com.acme.refund.approved', data: { by: 'dana' } },
        }),
      );
      return { started, sent, settled: await settled(session, started['run_id']) };
    });

    expect(ending).toMatchObject({
      started: { status: 'started' },
      sent: { isError: false },
      settled: { status: 'succeeded', output: { refund: 'ticket-4711', approved_by: 'dana' } },
    });
  });
});

const FirstPlaybookSchema = Schema.Struct({
  messages: Schema.Tuple([
    Schema.Struct({ content: Schema.Struct({ text: Schema.String }) }),
    Schema.Struct({ content: Schema.Struct({ resource: Schema.Struct({ uri: Schema.String, text: Schema.String }) }) }),
  ]),
});

function inTheirOrder(steps: string, names: readonly string[]): boolean {
  const places = names.map((name) => steps.indexOf(name));
  return places.every((place, index) => place >= 0 && (index === 0 || place > Number(places[index - 1])));
}

describe('the first-playbook prompt of the quick start, over /mcp', () => {
  it('is served by the playbook, and an agent that follows its steps creates a playbook, saves a reasoning function and runs it', async () => {
    const outcome = await onPnpmDev(async (session) => {
      const {
        messages: [asked, embedded],
      } = Schema.decodeUnknownSync(FirstPlaybookSchema)(await session.getPrompt('first-playbook'));
      return {
        recipe: asked.content.text,
        guide: embedded.content.resource,
        playbooks: structured(await session.callTool('list_playbooks', {})),
        playbook: structured(
          await session.callTool('create_playbook', {
            playbook,
            name: 'Support',
            description: 'Classifies support tickets',
          }),
        ),
        stored: await stored(session, 'reasoning', 'classify-ticket', classifyingPrompt('Answer as JSON.')),
        run: await ran(session, 'classify-ticket', { ticket: charged }),
      };
    });

    expect(outcome.recipe).toMatch(/^Create my first playbook\.\n\n# Create your first playbook\n/u);
    expect(
      inTheirOrder(outcome.recipe, ['list_playbooks', 'create_playbook', 'create_definition', 'run_definition']),
    ).toBe(true);
    expect(outcome.guide.uri).toBe('guide://reasoning-function');
    expect(outcome.guide.text).toContain('# Reasoning function format');
    expect(outcome).toMatchObject({
      playbooks: { isError: false, playbooks: [] },
      playbook: { isError: false, id: playbook, status: 'active' },
      stored: { isError: false, name: 'classify-ticket', version: 1 },
      run: { status: 'succeeded', output: { category: 'billing', urgency: 'high' } },
    });
  });
});
