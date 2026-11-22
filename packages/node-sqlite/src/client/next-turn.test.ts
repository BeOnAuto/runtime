import { AsyncLocalStorage } from 'node:async_hooks';

import { describe, expect, it } from 'vitest';

import { onTheNextTurn } from './next-turn.ts';
import { inTurn } from './statements.ts';

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

  it('lets what one statement set going run before the statement after it, a turn of the event loop between them', async () => {
    const order: string[] = [];
    const statements = [
      () => {
        setImmediate(() => {
          order.push('what the first statement set going');
        });
        order.push('the first statement');
      },
      () => {
        order.push('the second statement');
      },
    ];

    await inTurn(statements, (statement) => onTheNextTurn(statement));

    expect(order).toEqual(['the first statement', 'what the first statement set going', 'the second statement']);
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
