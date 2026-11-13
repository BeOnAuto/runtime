import { PayloadOffloading, PayloadsShared, sharedPayloadsWithin } from '@on.auto/operations/payloads';
import { mostInlineHeldValueBytes } from '@on.auto/workflow-engine';
import { Context, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { keptOf, notesKept, storeOn } from '../payload-testing/kept-payloads.ts';
import { runKeyOf } from './run-address.ts';
import { HeldValueSizeThreshold, hostPayloadsOf } from './run-payloads.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const alphaRun = runKeyOf({ ...alpha, runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' });

const value = { text: 'a'.repeat(20_000) };

const answer = keptOf(value);

async function keptAndReadBy(outside: boolean) {
  const shared = sharedPayloadsWithin(1_048_576);
  const store = storeOn(true, shared);
  await Effect.runPromise(store.payloads.keep(alphaRun, [answer]));
  const payloads = hostPayloadsOf({
    content: store.content,
    context: Context.make(PayloadOffloading, outside).pipe(Context.add(PayloadsShared, shared)),
    note: notesKept().note,
  });
  const read = await Effect.runPromise(payloads.factsOf(alpha).json({ sha256: answer.sha256, bytes: answer.bytes }));
  return { outside: payloads.runs.payloadOffloading, read, gets: store.gets() };
}

function thresholdComposedFrom(context: Context.Context<never>): number {
  return hostPayloadsOf({ content: storeOn().content, context, note: notesKept().note }).runs.payloadSizeThreshold;
}

describe('the threshold past which the host keeps a value its runs hold outside their logs', () => {
  it('is the one its runtime gives, and the engine’s own where it gives none', () => {
    expect([
      thresholdComposedFrom(Context.make(HeldValueSizeThreshold, 4096)),
      thresholdComposedFrom(Context.empty()),
    ]).toEqual([4096, mostInlineHeldValueBytes]);
  });
});

describe('the payloads the host composes from the context of its runtime', () => {
  it('read a value kept earlier through the set its runtime shares whatever the switch, which decides only whether new values are kept outside', async () => {
    expect([await keptAndReadBy(false), await keptAndReadBy(true)]).toEqual([
      { outside: false, read: value, gets: 0 },
      { outside: true, read: value, gets: 0 },
    ]);
  });
});
