import { chatDelivery } from '@on.auto/interaction/testing';
import { describe, expect, it } from 'vitest';

import {
  chatEnvironment,
  chatKey,
  chatServer,
  deliveryHistoryOf,
  deliveryRowsOf,
} from '../testing/interaction-servers/chat-deliveries.ts';
import { servingInteractions } from '../testing/interaction-servers/interaction-server.ts';
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
