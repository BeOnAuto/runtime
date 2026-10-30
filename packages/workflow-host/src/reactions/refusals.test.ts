import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { onSQLite, openedOn } from '../testing/host-files.ts';
import { reactionsStreamOf, refusalsOn } from './refusals.ts';

const playbookKey = 'playbook/acme/alpha/';

const minute = Date.parse('2026-10-01T09:00:00.000Z');

const aMinute = 60_000;

describe('the refusals of the reactions of a workflow', () => {
  it('are recorded through their decider once a minute ends, counted, with the last reason and the version of the workflow, at the next refusal or the next flush', async () => {
    const database = await openedOn(await onSQLite());
    const time = { now: minute + 1000 };
    const refusals = refusalsOn(database, () => time.now);
    const refuse = (reason: string) =>
      Effect.runPromise(refusals.refuse(playbookKey, { workflow: 'close', version: 3 }, reason));

    await refuse('first');
    await refuse('second');
    const flushedEarly = await Effect.runPromise(refusals.flush());
    time.now = minute + aMinute + 1000;
    await refuse('third');
    time.now = minute + 2 * aMinute;
    const flushed = await Effect.runPromise(refusals.flush());
    const flushedAgain = await Effect.runPromise(refusals.flush());
    time.now = minute + 3 * aMinute;
    await refuse('fourth');
    const { messages } = await database.store.read(reactionsStreamOf(playbookKey, 'close'));
    const ofClose = { by: 'playbook:alpha', definitionType: 'workflow', definitionName: 'close', definitionVersion: 3 };

    expect([flushedEarly, flushed, flushedAgain]).toEqual([0, 1, 0]);
    expect(messages.map(({ type, data, context }) => ({ type, data, context }))).toEqual([
      {
        type: 'reaction_refused',
        data: { count: 2, reason: 'second', minute: '2026-10-01T09:00:00.000Z' },
        context: { at: '2026-10-01T09:01:01.000Z', ...ofClose },
      },
      {
        type: 'reaction_refused',
        data: { count: 1, reason: 'third', minute: '2026-10-01T09:01:00.000Z' },
        context: { at: '2026-10-01T09:02:00.000Z', ...ofClose },
      },
    ]);
  });
});
