import type { CancelReceipt, CancelRun } from '@on.auto/definitions';
import { Conflict } from '@on.auto/operations';
import type { DueWork } from '@on.auto/workflow-host';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { cancelsAgainOf } from './cancels-again.ts';

const run = {
  org: 'acme',
  playbook: 'alpha',
  id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  definitionType: 'echo',
  name: 'greet',
};

const request = { kind: 'deadline', reason: 'The step that waited for this run ran out of time' } as const;

const lineage = { causationId: null, correlationId: run.id };

const quietForMs = 70_000;

const requested: CancelReceipt = 'requested';

interface Asking {
  readonly at: (moment: number) => void;
  readonly work: DueWork;
  readonly asked: () => number;
  readonly answer: (next: 'looks_again' | 'ended' | 'fails') => void;
  readonly lookedAgain: () => Promise<void>;
  readonly performed: () => Promise<readonly string[]>;
  readonly next: () => Promise<number | null>;
}

function asking(): Asking {
  const time = { now: 0 };
  const state: { asked: number; answer: 'looks_again' | 'ended' | 'fails' } = { asked: 0, answer: 'ended' };
  const again = cancelsAgainOf(() => time.now);
  const cancel: CancelRun = () =>
    Effect.suspend(() => {
      state.asked += 1;
      if (state.answer === 'fails') {
        return Effect.fail(new Conflict({ detail: 'The ledger could not be written' }));
      }
      return state.answer === 'looks_again'
        ? Effect.as(again.lookAgain({ run, request, lineage, quietForMs }), requested)
        : Effect.succeed<CancelReceipt>('ended');
    });
  const work = again.workOf(cancel);
  return {
    at: (moment) => {
      time.now = moment;
    },
    work,
    asked: () => state.asked,
    answer: (next) => {
      state.answer = next;
    },
    lookedAgain: () => Effect.runPromise(again.lookAgain({ run, request, lineage, quietForMs })),
    performed: async () => {
      const items = await Effect.runPromise(Effect.orDie(work.due(time.now, 16, false)));
      await Effect.runPromise(
        Effect.forEach(items, (item) => Effect.ignore(item.perform(time.now)), { discard: true }),
      );
      return items.map(({ key }) => key);
    },
    next: () => Effect.runPromise(Effect.orDie(work.nextDueAt(time.now))),
  };
}

describe('a cancel of a run within its call that may still be live, on Node', () => {
  it('is asked again once the run has been quiet as long as it may take, and a second more, and let go once it ended', async () => {
    const cancels = asking();
    await cancels.lookedAgain();

    const before = await cancels.performed();
    const next = await cancels.next();
    cancels.at(quietForMs + 1000);
    const due = await cancels.performed();

    expect(before).toEqual([]);
    expect(next).toBe(quietForMs + 1000);
    expect(due).toEqual([run.id]);
    expect(cancels.asked()).toBe(1);
    expect(await cancels.next()).toBeNull();
  });

  it('is kept for another look where the run showed a fact meanwhile, and asked a minute on where it could not be asked', async () => {
    const cancels = asking();
    await cancels.lookedAgain();
    cancels.answer('looks_again');
    cancels.at(quietForMs + 1000);
    await cancels.performed();
    const lookedAgainAt = await cancels.next();
    cancels.answer('fails');
    cancels.at(2 * (quietForMs + 1000));
    await cancels.performed();

    expect(lookedAgainAt).toBe(2 * (quietForMs + 1000));
    expect(await cancels.next()).toBe(2 * (quietForMs + 1000) + 60_000);
  });
});

describe('a cancel of a run within its call that may still be live, on Node, asked again for an hour', () => {
  it('is let go an hour after it was first kept, as the cloud gives up a call', async () => {
    const cancels = asking();
    await cancels.lookedAgain();
    cancels.answer('fails');

    const moments = Array.from({ length: 61 }, (_, minute) => quietForMs + 1000 + minute * 60_000);
    await Effect.runPromise(
      Effect.forEach(moments, (moment) =>
        Effect.promise(() => {
          cancels.at(moment);
          return cancels.performed();
        }),
      ),
    );

    expect(await cancels.next()).toBeNull();
    expect(await Effect.runPromise(Effect.orDie(cancels.work.due(10 * 3_600_000, 16, true)))).toEqual([]);
    expect(await Effect.runPromise(Effect.orDie(cancels.work.nextDueAt(0, true)))).toBeNull();
  });
});
