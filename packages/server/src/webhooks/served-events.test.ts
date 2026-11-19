import type { ArrivedEvent } from '@on.auto/api';
import { connectionWake } from '@on.auto/interaction';
import { readOnce, theChannel } from '@on.auto/interaction/testing';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { wokenBy } from './served-events.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c';

const fiveSeconds = 5000;

function arrivedReading(reading: ArrivedEvent['reading']): ArrivedEvent {
  return {
    address: { org: 'acme', playbook: 'alpha', connection: 'chat' },
    reading,
    arrival: { transport: 'request', headers: {}, query: {} },
    provesTheBodyAndATime: false,
  };
}

async function wokenAt(reading: ArrivedEvent['reading']) {
  const waiting = await readOnce(runId);
  const before = await waiting.row();
  await Effect.runPromise(
    TestClock.setTime(waiting.readAt).pipe(
      Effect.andThen(wokenBy(connectionWake({ ledger: waiting.playbook.ledger.service }))(arrivedReading(reading))),
      Effect.provide(TestClock.layer()),
    ),
  );
  return { before, after: await waiting.row(), readAt: waiting.readAt };
}

describe('a delivery the events address proves', () => {
  it('makes the conversation it names, waiting through its connection, due the shortest wait of its reading after it arrives', async () => {
    const { before, after, readAt } = await wokenAt({ wake: { conversation: theChannel } });

    expect(after).toEqual({ ...before, due_at: readAt + fiveSeconds });
  });

  it('makes every conversation waiting through its connection due where it names none, as a subscription’s may', async () => {
    const { before, after, readAt } = await wokenAt({ wake: { subscription: 'hook-7' } });

    expect(after).toEqual({ ...before, due_at: readAt + fiveSeconds });
  });

  it('wakes nothing where its reading holds no wake', async () => {
    const { before, after } = await wokenAt({ connection: { account: 'W-9' } });

    expect(after).toEqual(before);
  });
});
