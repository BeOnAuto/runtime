import { streamPrefixOfPlaybook } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runStreamNameOf } from '../runs/run-decider.ts';
import { relayedId, settledAt, withHandOn } from '../testing/relaying.ts';
import { outputsKeptIn, resultedAlone } from './settled-outputs.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const neverStarted = '0199a3c4-7d2e-7c1a-9b3f-000000000000';

function streamOf(id: string): string {
  return `${streamPrefixOfPlaybook(alpha)}${runStreamNameOf(id)}`;
}

const rejected = resultedAlone({
  type: 'run_rejected',
  data: { rejection: { reason: 'unavailable', detail: 'Busy' } },
});

describe('the values the settler that keeps outputs reads to compare a settlement', () => {
  it('are none for a run never started, nor for a run whose ending or offer is no success', async () => {
    const handed = await withHandOn();
    await handed.running();
    await handed.settling({ status: 'succeeded', output: { small: true }, record: {} });
    const { toCompare } = outputsKeptIn(handed.ledger.service);

    const read = await handed.run(
      Effect.orDie(
        Effect.all([
          toCompare({ run: alpha, stream: streamOf(neverStarted), offered: rejected }),
          toCompare({ run: alpha, stream: streamOf(relayedId), offered: rejected }),
        ]),
      ),
      settledAt,
    );

    expect(read).toEqual([new Map(), new Map()]);
  });
});
