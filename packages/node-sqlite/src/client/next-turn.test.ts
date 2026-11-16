import { AsyncLocalStorage } from 'node:async_hooks';

import { describe, expect, it } from 'vitest';

import { onTheNextTurn } from './next-turn.ts';
import { inTurn } from './statements.ts';

function aStatementHoldingTheThreadFor(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

describe('a statement', () => {
  it('runs and answers on a later turn of the event loop, after what was already waiting for one', async () => {
    const order: string[] = [];
    setImmediate(() => {
      order.push('a waiting turn');
    });

    const answered = onTheNextTurn(() => {
      order.push('the statement');
      return 'answer';
    });
    order.push('the caller carries on');

    expect(await answered).toBe('answer');
    expect(order).toEqual(['the caller carries on', 'a waiting turn', 'the statement']);
  });

  it('lets a timer fire between statements that follow each other', async () => {
    const order: string[] = [];
    setTimeout(() => {
      order.push('the timer');
    }, 1);

    await inTurn(
      Array.from({ length: 20 }, (_, place) => place),
      (place) =>
        onTheNextTurn(() => {
          aStatementHoldingTheThreadFor(0.5);
          order.push(`statement ${place}`);
        }),
    );

    expect(order.indexOf('the timer')).toBeGreaterThan(0);
    expect(order.indexOf('the timer')).toBeLessThan(order.length - 1);
  });
});

describe('a statement that runs on a later turn', () => {
  it('runs in the async context of its caller', async () => {
    const context = new AsyncLocalStorage<string>();

    expect(await context.run('the caller', () => onTheNextTurn(() => context.getStore()))).toBe('the caller');
  });

  it('fails on that later turn when the statement fails', async () => {
    const refusal = new Error('refused');

    await expect(
      onTheNextTurn(() => {
        throw refusal;
      }),
    ).rejects.toBe(refusal);
  });
});
