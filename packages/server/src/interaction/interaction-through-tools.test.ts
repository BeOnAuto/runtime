import { openRequests } from '@on.auto/interaction';
import { agentDelivery, chatDelivery } from '@on.auto/interaction/testing';
import { projectedTableOf } from '@on.auto/operations';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import {
  chatEnvironment,
  chatKey,
  chatServer,
  deliveryHistoryOf,
  deliveryRowsOf,
} from '../testing/interaction-servers/chat-deliveries.ts';
import { brief, interactionServerOn, servingInteractions } from '../testing/interaction-servers/interaction-server.ts';
import { everyRowSet, onTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { runIdIn } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

const aNumber: unknown = expect.any(Number);

const scrubbedBrief: unknown = expect.stringMatching(/^Please review the brief for \[redacted\] x{5000}\.$/u);

function endedFacts(server: Awaited<ReturnType<typeof servingInteractions>>, runId: string) {
  return until(
    () => deliveryHistoryOf(server, runId),
    (facts) => facts.some(({ type }) => type !== 'delivery_started'),
  );
}

async function dueNow(file: string): Promise<void> {
  await onTheLedgerIn(file, (connection) =>
    connection.write(everyRowSet(projectedTableOf(openRequests), { next_attempt_at: 0, attempt_due_at: 0 })),
  );
}

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }),
);

function asked(server: Awaited<ReturnType<typeof servingInteractions>>) {
  return server.call('POST', `${alpha}/definitions/interaction/approve-brief/run`, {
    body: { input: brief, run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
  });
}

async function refusedThrough(environment: Readonly<Record<string, string>>) {
  const server = await servingInteractions(chatDelivery, environment);
  const refusal = await asked(server);
  const history = await server.call('GET', `${alpha}/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a/history`);
  return { refusal: refusal.body, types: decodeHistory(history.body).events.map(({ type }) => type) };
}

const limitApproval = [
  '---',
  "to: '{{ input.owner }}'",
  'expires: P2D',
  'deliver:',
  '  server: chat',
  '  tool: echo',
  '  with:',
  '    count: 3',
  '    unfurl: false',
  "    limit: '{{ input.limit }}'",
  "    text: 'Hello {{ to }}'",
  "    block: { type: section, text: '{{ message }}' }",
  "    schema: '{{ answer_schema }}'",
  'input:',
  '  schema:',
  '    type: object',
  '    required: [owner, limit]',
  '    properties:',
  '      owner: { type: string }',
  '      limit: { type: integer }',
  'output:',
  '  schema:',
  '    type: object',
  '    required: [choice]',
  '    properties:',
  '      choice: { type: string, enum: [approve, reject] }',
  '---',
  'Approve the limit of {{ input.limit }}?',
].join('\n');

const answerSchema = {
  type: 'object',
  required: ['choice'],
  properties: { choice: { type: 'string', enum: ['approve', 'reject'] } },
};

describe('an interaction function that delivers through a tool, over HTTP', () => {
  it('posts its request with one recorded call, its sizes and the digests of what it kept', async () => {
    const chat = await chatServer();
    const server = await servingInteractions(chatDelivery, chatEnvironment(chat.url));
    const runId = await server.ask('approve-brief');

    const facts = await endedFacts(server, runId);
    const listed = await server.call('GET', `${alpha}/interactions`);

    expect(chat.chat.posted()).toMatchObject([
      { channel: '#approvals-ada', text: 'Please review the brief for Spring.' },
    ]);
    expect(facts).toEqual([
      {
        type: 'delivery_started',
        number: 1,
        target: 'ada',
        server: 'chat',
        tool: 'post_message',
        arguments_bytes: 73,
        arguments_sha256: aDigest,
        arguments: { channel: '#approvals-ada', text: 'Please review the brief for Spring.' },
      },
      {
        type: 'delivery_succeeded',
        number: 1,
        result_bytes: aNumber,
        result_sha256: aDigest,
        jsonrpc_id: aNumber,
        duration_ms: aNumber,
        delivered_as: { conversation: '#approvals-ada', id: '1699.000001' },
        answer: { channel: '#approvals-ada', ok: true, ts: '1699.000001' },
      },
    ]);
    expect(listed.body).toMatchObject({
      interactions: [{ run_id: runId, delivery: { server: 'chat', tool: 'post_message' }, standing: 'delivered' }],
    });
  });
});

describe('the delivery of a request, in the feed of its playbook', () => {
  it('shows when the feed is filtered by the type of the fact', async () => {
    const chat = await chatServer();
    const server = await servingInteractions(chatDelivery, chatEnvironment(chat.url));
    const runId = await server.ask('approve-brief');
    await endedFacts(server, runId);

    const delivered = await server.call('GET', `${alpha}/events?type=delivery_succeeded`);

    expect(delivered.body).toMatchObject({
      events: [
        { type: 'delivery_succeeded', data: { number: 1, result_sha256: aDigest }, metadata: { run_id: runId } },
      ],
      has_more: false,
    });
  });
});

describe('a request delivered through a tool, as the history of its run keeps it', () => {
  it('keeps the arguments and the answer scrubbed, shows on the history what fits 2 KiB, and reads the rest whole as one event', async () => {
    const chat = await chatServer();
    const server = await servingInteractions(chatDelivery, chatEnvironment(chat.url));
    const started = await server.call('POST', `${alpha}/definitions/interaction/approve-brief/run`, {
      body: { input: { owner: 'ada', campaign: `${chatKey} ${'x'.repeat(5000)}` } },
    });
    const runId = runIdIn(started.body);

    const [start, end] = await endedFacts(server, runId);
    const [startRow] = await deliveryRowsOf(server, runId);
    const whole = await server.call('GET', `${alpha}/events/${String(startRow?.id)}`);

    expect(start).not.toHaveProperty('arguments');
    expect(start?.['arguments_bytes']).toBeGreaterThan(5000);
    expect(whole.body).toMatchObject({ data: { arguments: { channel: '#approvals-ada', text: scrubbedBrief } } });
    expect(end?.['answer']).toMatchObject({ channel: '#approvals-ada', ok: true });
  });

  it('succeeds a notification once delivered, its ending caused by the delivery that succeeded', async () => {
    const chat = await chatServer();
    const server = await servingInteractions(chatDelivery, chatEnvironment(chat.url));
    const runId = await server.ask('brief-out');

    expect(await server.settled(runId)).toMatchObject({ status: 'succeeded', output: {} });
    expect(await server.causes(runId)).toEqual([
      ['run_started', null],
      ['interaction_requested', 'run_started'],
      ['delivery_started', 'interaction_requested'],
      ['delivery_succeeded', 'delivery_started'],
      ['run_succeeded', 'delivery_succeeded'],
    ]);
  });
});

describe('a tool its operator disallowed after a request asked through it', () => {
  it('fails the next attempt as a tool no longer offered, and the request stays open, answered with answer_interaction', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const unreachable = await chatServer();
    await unreachable.close();
    const first = await servingInteractions(chatDelivery, {
      ...chatEnvironment(unreachable.url),
      LEDGER_FILE: ledger.fileName,
    });
    const runId = await first.ask('approve-brief');
    const unreached = await until(
      () => deliveryHistoryOf(first, runId),
      (seen) => seen.length >= 2,
    );
    await first.stop();
    await dueNow(ledger.fileName);

    const chat = await chatServer();
    const second = await interactionServerOn({
      ...chatEnvironment(chat.url, { allowed: ['echo'] }),
      LEDGER_FILE: ledger.fileName,
    });
    const facts = await until(
      () => deliveryHistoryOf(second, runId),
      (seen) => seen.length >= 4,
    );
    const answered = await second.answer(runId, { answer: { choice: 'approve' } });

    expect(unreached[1]).toEqual({
      type: 'delivery_failed',
      number: 1,
      because: 'server_failure',
      detail: 'The tool server chat could not be used: The tool server could not be reached',
      duration_ms: aNumber,
    });
    expect(facts.at(-1)).toMatchObject({
      type: 'delivery_failed',
      because: 'tool_not_offered',
      detail: 'The operator of this server does not allow chat/post_message',
    });
    expect(answered.status).toBe(200);
    expect(chat.received()).toEqual([]);
  });
});

describe('a delivery through a tool this playbook may not use, over HTTP', () => {
  it('ends its run unavailable at the start, before anything is asked, in the words of the tool servers', async () => {
    const chat = await chatServer();

    const refusals = await Promise.all([
      refusedThrough({}),
      refusedThrough(chatEnvironment(chat.url, { org: 'globex' })),
      refusedThrough(chatEnvironment(chat.url, { allowed: ['echo'] })),
    ]);

    expect(refusals).toMatchObject([
      {
        refusal: { reason: 'unavailable', kind: 'tool_not_offered', because: 'tool_server_not_configured' },
        types: ['run_started', 'run_rejected'],
      },
      { refusal: { detail: 'No tool server named chat is configured for this playbook' } },
      {
        refusal: {
          because: 'tool_not_allowed',
          detail: 'The operator of this server does not allow chat/post_message',
        },
        types: ['run_started', 'run_rejected'],
      },
    ]);
    expect(chat.received()).toEqual([]);
  });

  it('fails an attempt as a tool no longer offered when the server no longer lists the tool, sending nothing, and tries again', async () => {
    const chat = await chatServer();
    chat.removeTool('post_message');
    const server = await servingInteractions(chatDelivery, chatEnvironment(chat.url));
    const runId = await server.ask('approve-brief');

    const facts = await until(
      () => deliveryHistoryOf(server, runId),
      (seen) => seen.length >= 2,
    );

    expect(facts.at(-1)).toMatchObject({
      type: 'delivery_failed',
      because: 'tool_not_offered',
      detail: 'The tool server chat does not list the tool post_message',
    });
    expect(chat.received()).toEqual([]);
    expect((await server.call('GET', `${alpha}/interactions`)).body).toMatchObject({
      interactions: [{ standing: 'retrying' }],
    });
  });
});

describe('the arguments of a delivery, typed as written, over HTTP', () => {
  it('sends a number, a boolean and an object as written, an expression alone as its value, and other strings as text', async () => {
    const chat = await chatServer();
    const server = await servingInteractions(agentDelivery, chatEnvironment(chat.url));
    await server.call('POST', `${alpha}/definitions/interaction`, {
      body: { name: 'approve-limit', source: limitApproval, diagram: 'none' },
    });

    await server.call('POST', `${alpha}/definitions/interaction/approve-limit/run`, {
      body: { input: { owner: 'ada', limit: 20 } },
    });
    const [received] = await until(
      () => Promise.resolve(chat.received()),
      (calls) => calls.length > 0,
    );

    expect(received?.arguments).toEqual({
      count: 3,
      unfurl: false,
      limit: 20,
      text: 'Hello ada',
      block: { type: 'section', text: 'Approve the limit of 20?' },
      schema: answerSchema,
    });
  });
});
