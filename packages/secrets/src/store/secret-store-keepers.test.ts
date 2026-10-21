import { DateTime, Effect, Logger, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { memoryKeeper, memoryKeeperRefusal } from '../fakes/memory-keeper.ts';
import type { Keeper } from '../keepers/keeper.ts';
import { heldElsewhere } from '../testing/holdings.ts';
import { memoryRows } from '../testing/memory-rows.ts';
import { SecretRefused } from './secret-refused.ts';
import { secretStoreOn } from './secret-store.ts';

const now = Effect.map(DateTime.now, DateTime.toEpochMillis);

async function loggedWhile<A, E>(effect: Effect.Effect<A, E>): Promise<string> {
  const lines: string[] = [];
  const capture = Logger.map(Logger.formatJson, (line: string) => {
    lines.push(line);
  });
  await Effect.runPromise(Effect.exit(effect).pipe(Effect.provide(Logger.layer([capture]))));
  return lines.join('\n');
}

const leftBehind = 'A value no secret names any more is left where it was kept, until it is deleted there';

describe('a secret forgotten whose value its keeper does not release', () => {
  it('is forgotten all the same, and the store logs where its value is left, never the value', async () => {
    const rows = memoryRows({ now });
    const keeper = memoryKeeper();
    const store = secretStoreOn(rows, { current: keeper });
    const id = await Effect.runPromise(store.keep(Redacted.make('pasted-key')));
    await Effect.runPromise(rows.keep('secret-4', heldElsewhere));
    keeper.refuse();

    const refused = await loggedWhile(store.forget(id));
    const unknown = await loggedWhile(store.forget('secret-4'));
    keeper.answer();

    expect(rows.kept()).toEqual([]);
    expect(refused).toContain(`${leftBehind}: ${memoryKeeperRefusal}`);
    expect(unknown).toContain(
      `${leftBehind}: The secret is kept by the keeper another-keeper, which is neither the current keeper nor the previous one`,
    );
    expect(`${refused}${unknown}`).not.toContain('pasted-key');
    expect(keeper.released()).toEqual([]);
  });
});

describe('a move whose current keeper does not hold a value', () => {
  it('fails in the words of that keeper, leaving each row with the previous keeper, and moves it once the keeper holds again', async () => {
    const rows = memoryRows({ now });
    const [previous, current] = [memoryKeeper('previous'), memoryKeeper('current')];
    const id = await Effect.runPromise(secretStoreOn(rows, { current: previous }).keep(Redacted.make('pasted-key')));
    current.refuse();

    const refused = await Effect.runPromise(Effect.flip(secretStoreOn(rows, { current, previous }).moved()));
    current.answer();
    const moved = await Effect.runPromise(secretStoreOn(rows, { current, previous }).moved());

    expect(refused).toMatchObject({ _tag: 'keeper_unavailable', detail: memoryKeeperRefusal });
    expect(moved).toBe(1);
    expect(previous.released()).toEqual([{ keptBy: 'previous', held: `${id}:1` }]);
    expect(rows.kept().map(({ kept_by, held }) => [kept_by, held])).toEqual([['current', `${id}:1`]]);
  });
});

function refusingBraces(keeper: Keeper): Keeper {
  return {
    ...keeper,
    hold: (id, value) =>
      Redacted.value(value).startsWith('{{')
        ? Effect.fail(new SecretRefused({ because: 'refused_by_the_keeper', detail: 'The keeper refuses braces' }))
        : keeper.hold(id, value),
  };
}

describe('a move whose current keeper refuses a value', () => {
  it('leaves that row with the previous keeper, logged with its id, and moves the rest', async () => {
    const rows = memoryRows({ now });
    const [previous, current] = [memoryKeeper('previous'), memoryKeeper('current')];
    const keeping = secretStoreOn(rows, { current: previous });
    const [kept, refused] = await Effect.runPromise(
      Effect.forEach(['pasted-key', '{{ssm:another}}'], (value) => keeping.keep(Redacted.make(value))),
    );

    const logged = await loggedWhile(secretStoreOn(rows, { current: refusingBraces(current), previous }).moved());

    expect(new Map(rows.kept().map(({ id, kept_by }) => [id, kept_by]))).toEqual(
      new Map([
        [kept, 'current'],
        [refused, 'previous'],
      ]),
    );
    expect(logged).toContain(
      'A secret is left with the previous keeper, unmoved, since the current one refused its value: The keeper refuses braces',
    );
    expect(logged).toContain(`"secret_id":"${String(refused)}"`);
  });
});

describe('a secret store without custodians', () => {
  it('wraps nothing again, since no row it keeps is sealed', async () => {
    const store = secretStoreOn(memoryRows({ now }), { current: memoryKeeper() });

    expect(await Effect.runPromise(store.rotated())).toBe(0);
  });
});
