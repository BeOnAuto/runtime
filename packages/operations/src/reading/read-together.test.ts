import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { AskedTogether, askedTogether, readOnceTogether, togetherAsked } from './read-together.ts';

function counted(answer: string) {
  const reads: string[] = [];
  const read = (key: string) =>
    Effect.sync(() => {
      reads.push(key);
      return `${answer} ${key}`;
    });
  return { reads, read };
}

describe('a read asked together', () => {
  it('is read once for each key while one asking lasts, its answer shared by every read of it', async () => {
    const once = readOnceTogether<string>();
    const { reads, read } = counted('rows of');
    const asking = Effect.all(
      [once.read('acme', read('acme')), once.read('acme', read('acme')), once.read('globex', read('globex'))],
      { concurrency: 'unbounded' },
    );

    const answers = await Effect.runPromise(askedTogether(Effect.all([asking, asking])));

    expect(answers).toEqual([
      ['rows of acme', 'rows of acme', 'rows of globex'],
      ['rows of acme', 'rows of acme', 'rows of globex'],
    ]);
    expect(reads).toEqual(['acme', 'globex']);
  });

  it('is read each time where nothing is asked together, and again for each asking', async () => {
    const once = readOnceTogether<string>();
    const { reads, read } = counted('rows of');
    const twice = Effect.all([once.read('acme', read('acme')), once.read('acme', read('acme'))]);

    await Effect.runPromise(twice);
    await Effect.runPromise(askedTogether(once.read('acme', read('acme'))));
    await Effect.runPromise(askedTogether(once.read('acme', read('acme'))));

    expect(reads).toEqual(['acme', 'acme', 'acme', 'acme']);
  });
});

describe('an asking', () => {
  it('keeps the asking it is already part of', async () => {
    const outer = togetherAsked();

    const inner = await Effect.runPromise(
      askedTogether(
        Effect.gen(function* () {
          return yield* AskedTogether;
        }),
      ).pipe(Effect.provideService(AskedTogether, outer)),
    );

    expect(inner).toBe(outer);
  });
});

describe('a read asked together that fails', () => {
  it('shares its failure with every read waiting on it', async () => {
    const once = readOnceTogether<string, string>();
    const failing = Effect.all(
      [Effect.flip(once.read('acme', Effect.fail('unread'))), Effect.flip(once.read('acme', Effect.succeed('rows')))],
      { concurrency: 'unbounded' },
    );

    expect(await Effect.runPromise(askedTogether(failing))).toEqual(['unread', 'unread']);
  });
});
