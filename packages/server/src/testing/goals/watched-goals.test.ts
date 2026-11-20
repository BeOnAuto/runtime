import { PlaybookGoalsEventSchema } from '@on.auto/goals';
import { Conflict, type Decider } from '@on.auto/operations';
import { Effect, Result } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { temporaryLedger } from '../records/temporary-ledger.ts';
import { servedWatched } from './watched-goals.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const unknownDigest = 'e'.repeat(64);

const refusing: Decider<'none', 'refuse', typeof PlaybookGoalsEventSchema.Type, 'conflict'> = {
  initialState: 'none',
  evolve: (state) => state,
  decide: () => Result.fail(new Conflict({ detail: 'Refused for the watch' })),
  context: () => ({ at: '2026-11-13T09:00:00.000Z', by: 'person_watching' }),
  eventSchema: PlaybookGoalsEventSchema,
};

describe('the watch over the goals engine’s ports on a Node server', () => {
  it('tells each read of the records, of content and of a chain, and each execute that failed, as the engine asks it', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const watched = await servedWatched(ledger);
    onTestFinished(watched.server.stop);
    const ports = await watched.watch.ports;

    await Effect.runPromise(ports.ledger.readRecorded(alpha, { kind: 'everything' }, { order: 'asc', limit: 1 }));
    await Effect.runPromise(ports.ledger.readRecordedEvent(alpha, 'no-such-fact'));
    await Effect.runPromise(Effect.exit(ports.ledger.content.get(alpha, unknownDigest)));
    await Effect.runPromise(Effect.exit(ports.ledger.content.getHead(alpha, unknownDigest)));
    await ports.database.store.readRecorded('acme/alpha', { kind: 'everything' }, { order: 'asc', limit: 1 });
    await ports.database.store.readRecordedEvent('acme/alpha', 'no-such-fact');
    await Effect.runPromise(Effect.exit(ports.ledger.execute('watched/refused', refusing, 'refuse')));

    expect(watched.watch.asked.filter((asked) => /^(recorded|content|chain|failed)/u.test(asked))).toEqual([
      'recorded alpha',
      'recorded event alpha',
      'content alpha',
      'content head alpha',
      'chain acme/alpha',
      'chain event acme/alpha',
      'failed watched/refused',
    ]);
  });
});
