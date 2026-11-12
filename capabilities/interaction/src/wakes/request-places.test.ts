import { deferredCanceller } from '@on.auto/definitions';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { askedRunId, askedThroughChat } from '../testing/asked-requests.ts';
import { chatHarness, recordsOf, type ChatHarness } from '../testing/chat-harness.ts';
import { alpha } from '../testing/interaction-harness.ts';
import { readOnce, theChannel } from '../testing/woken-conversations.ts';
import { requestPlaceOf } from './request-places.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7d';

function placeIn(playbook: Pick<ChatHarness, 'ledger'>, request = runId) {
  return Effect.runPromise(requestPlaceOf({ ledger: playbook.ledger.service }, alpha, request));
}

const decodeDeferred = Schema.decodeUnknownSync(
  Schema.Struct({ data: Schema.Struct({ record: Schema.Struct({ expires_at: Schema.String }) }) }),
);

const decodeRecorded = Schema.decodeUnknownSync(
  Schema.Struct({ data: Schema.Struct({ record: Schema.Record(Schema.String, Schema.Unknown) }) }),
);

async function expiryOf(playbook: Pick<ChatHarness, 'ledger'>): Promise<number> {
  const [deferred] = await recordsOf(playbook.ledger, 'run_deferred');
  return Date.parse(decodeDeferred(deferred).data.record.expires_at);
}

describe('the place of a request that reads its replies', () => {
  it('is the conversation it was delivered in, through its connection, until it expires, named for the provider of that connection', async () => {
    const playbook = await chatHarness();
    await playbook.askInThread(runId);
    await playbook.performDue(Date.now());

    expect(await placeIn(playbook)).toEqual({
      request: runId,
      provider: 'chat',
      waits: { connection: 'chat', conversation: theChannel, until: await expiryOf(playbook) },
    });
  });

  it('names the provider the request recorded as it was asked, and no place before it is delivered', async () => {
    const playbook = await chatHarness();
    await playbook.askInThread(runId);
    const [deferred] = await recordsOf(playbook.ledger, 'run_deferred');

    expect(deferred?.data).toMatchObject({ record: { deliver: { server: 'chat' }, provider: 'chat' } });
    expect(await placeIn(playbook)).toEqual({ request: runId, provider: 'chat' });
  });

  it('is nowhere once it is answered', async () => {
    const waiting = await readOnce(runId);
    waiting.approve();
    await waiting.playbook.performReads(waiting.readAt + 60_000);

    expect(await recordsOf(waiting.playbook.ledger, 'request_answered')).toHaveLength(1);
    expect(await placeIn(waiting.playbook)).toEqual({ request: runId, provider: 'chat' });
  });

  it('is nowhere once its run is cancelled', async () => {
    const playbook = await chatHarness();
    await playbook.askInThread(runId);
    await playbook.performDue(Date.now());
    await playbook.cancel(runId);
    await Effect.runPromise(
      deferredCanceller([playbook.capability], playbook.ledger.service)(
        { ...alpha, id: runId },
        { kind: 'requested', reason: 'Not needed any more', by: 'acme-admin' },
        { causationId: null, correlationId: runId },
      ),
    );

    expect(await placeIn(playbook)).toEqual({ request: runId, provider: 'chat' });
  });
});

describe('a run with no place', () => {
  it('is a run that asked no one', async () => {
    expect(await placeIn(await chatHarness())).toBeUndefined();
  });

  it('is a request that reads no replies, which records no provider', async () => {
    const { playbook } = await askedThroughChat();
    await playbook.performDue(Date.now());
    const [deferred] = await recordsOf(playbook.ledger, 'run_deferred');

    expect(deferred?.data).toMatchObject({ record: { deliver: { server: 'chat' } } });
    expect(Object.keys(decodeRecorded(deferred).data.record)).not.toContain('provider');
    expect(await placeIn(playbook, askedRunId)).toBeUndefined();
  });
});
