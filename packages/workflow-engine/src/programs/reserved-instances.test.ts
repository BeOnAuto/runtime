import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { freshInstance } from '../instances/fresh-instances.ts';
import type { Evaluation, ProgramRun } from './program-run.ts';
import { reservedSandbox, reusedSandbox, type MachineSandbox } from './reserved-instances.ts';
import { unitMemoryBytes } from './sandbox-bounds.ts';
import type { SandboxInstance } from './sandbox-session.ts';

const instance = await freshInstance(shippedFilesOnDisk, unitMemoryBytes);

const evaluation: Evaluation = { budget: 250, deadlineAt: Number.POSITIVE_INFINITY, moment: 0 };

function decidedIn(sandbox: MachineSandbox): ProgramRun {
  const unit = sandbox.unit();
  try {
    return unit.evaluate('$data * 2', { data: 21 }, evaluation);
  } finally {
    unit.close();
  }
}

interface Preparing {
  readonly prepare: () => Promise<SandboxInstance>;
  readonly prepared: () => number;
  readonly finishOne: () => Promise<void>;
}

function preparedOnDemand(): Preparing {
  const pending: (() => void)[] = [];
  const count = { prepared: 0 };
  return {
    prepare: () =>
      new Promise<SandboxInstance>((resolve) => {
        count.prepared += 1;
        pending.push(() => {
          resolve(instance);
        });
      }),
    prepared: () => count.prepared,
    finishOne: async () => {
      pending.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

async function settledSoon(promise: Promise<void>): Promise<boolean> {
  const state = { settled: false };
  void promise.then(() => {
    state.settled = true;
    return state.settled;
  });
  await Promise.resolve();
  await Promise.resolve();
  return state.settled;
}

describe('a sandbox of reserved instances', () => {
  it('prepares one spare instance before any input asks for it', () => {
    const preparing = preparedOnDemand();

    reservedSandbox(preparing.prepare, () => 0);

    expect(preparing.prepared()).toBe(1);
  });

  it('sets a ready instance aside for an input at once, prepares the next, and hands it to the decision that takes it', async () => {
    const preparing = preparedOnDemand();
    const sandbox = reservedSandbox(preparing.prepare, () => 7);
    await preparing.finishOne();

    const reserved = await settledSoon(Effect.runPromise(sandbox.reserve));

    expect(reserved).toBe(true);
    expect(preparing.prepared()).toBe(2);
    expect(decidedIn(sandbox)).toEqual({ ran: 'answered', text: '42', work: 0 });
    expect(sandbox.clock()).toBe(7);
  });

  it('makes an input wait while no instance is ready, and lets it go on once one is', async () => {
    const preparing = preparedOnDemand();
    const sandbox = reservedSandbox(preparing.prepare, () => 0);
    const reserving = Effect.runPromise(sandbox.reserve);

    const early = await settledSoon(reserving);
    await preparing.finishOne();

    expect(early).toBe(false);
    expect(await settledSoon(reserving)).toBe(true);
    expect(decidedIn(sandbox)).toMatchObject({ ran: 'answered', text: '42' });
  });
});

describe('the stock of a sandbox of reserved instances', () => {
  it('serves waiting inputs in turn, one instance each', async () => {
    const preparing = preparedOnDemand();
    const sandbox = reservedSandbox(preparing.prepare, () => 0);
    const first = Effect.runPromise(sandbox.reserve);
    const second = Effect.runPromise(sandbox.reserve);

    await preparing.finishOne();
    const afterOne = [await settledSoon(first), await settledSoon(second)];
    await preparing.finishOne();

    expect(afterOne).toEqual([true, false]);
    expect(await settledSoon(second)).toBe(true);
  });

  it('lets an instance an input set aside go back to the stock when its decision took none', async () => {
    const preparing = preparedOnDemand();
    const sandbox = reservedSandbox(preparing.prepare, () => 0);
    await preparing.finishOne();
    await Effect.runPromise(sandbox.reserve);

    sandbox.unit().close();
    const again = await settledSoon(Effect.runPromise(sandbox.reserve));

    expect(again).toBe(true);
    expect(preparing.prepared()).toBe(2);
  });

  it('refuses a decision that takes an instance no input set aside', () => {
    const sandbox = reservedSandbox(preparedOnDemand().prepare, () => 0);

    expect(() => decidedIn(sandbox)).toThrow('A decision took a sandbox no input had set aside');
  });
});

describe('a sandbox of one reused instance', () => {
  it('needs no reservation and evaluates every decision on the same instance', async () => {
    const sandbox = reusedSandbox(instance, () => 3);

    await Effect.runPromise(sandbox.reserve);

    expect([decidedIn(sandbox), decidedIn(sandbox), sandbox.clock()]).toEqual([
      { ran: 'answered', text: '42', work: 0 },
      { ran: 'answered', text: '42', work: 0 },
      3,
    ]);
  });
});
