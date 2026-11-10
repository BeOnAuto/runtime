import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { closingWorkOf } from './closing-work.ts';

describe('the closing of the calls of ended runs, as due work of the host', () => {
  it('is work that calls out nowhere: it hands out nothing among the work that does, and is never due there', async () => {
    const work = closingWorkOf(await openedOn({ store: 'sqlite', file: aSQLiteFile() }));

    const answered = await Effect.runPromise(
      Effect.all([work.due(Date.now(), 16, true), work.nextDueAt(0, true), work.nextDueAt(0, false)]),
    );

    expect([work.name, ...answered]).toEqual(['closed runs', [], null, null]);
  });
});
