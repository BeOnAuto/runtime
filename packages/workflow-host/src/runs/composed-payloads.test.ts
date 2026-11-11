import { PayloadsOutside, PayloadsShared, sharedPayloadsWithin } from '@on.auto/operations/payloads';
import { Context, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { keptOf, notesKept, storeOn } from '../payload-testing/kept-payloads.ts';
import { runKeyOf } from './run-address.ts';
import { hostPayloadsOf } from './run-payloads.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const alphaRun = runKeyOf({ ...alpha, runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' });

const answer = keptOf({ text: 'a'.repeat(20_000) });

async function keptBy(outside: boolean) {
  const shared = sharedPayloadsWithin(1_048_576);
  const payloads = hostPayloadsOf({
    content: storeOn().content,
    context: Context.make(PayloadsOutside, outside).pipe(Context.add(PayloadsShared, shared)),
    note: notesKept().note,
  });
  await Effect.runPromise(payloads.keep(alphaRun, [answer]));
  return { outside: payloads.keepsPayloadsOutside, cached: shared.cache.textOf(alpha, answer.sha256) };
}

describe('the payloads the host composes from the context of its runtime', () => {
  it('keep what the host kept in the set its runtime shares only while payloads are kept outside', async () => {
    expect([await keptBy(false), await keptBy(true)]).toEqual([
      { outside: false, cached: undefined },
      { outside: true, cached: answer.text },
    ]);
  });
});
