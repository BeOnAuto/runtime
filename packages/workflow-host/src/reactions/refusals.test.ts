import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { onSQLite, openedOn } from '../testing/host-files.ts';
import { reactionsStreamOf, refusalsOn, type Refusal } from './refusals.ts';

const playbookKey = 'playbook/acme/alpha/';

const minute = Date.parse('2026-10-01T09:00:00.000Z');

const aMinute = 60_000;

const ofClose = { workflow: 'close', version: 3 };

const daily = { kind: 'cron', reference: '/schedule/cron' } as const;

const onEvent = { kind: 'event', reference: '/schedule/on' } as const;

describe('the refusals of the reactions of a workflow', () => {
  it('are recorded through their decider once a minute ends, counted, with the last reason, its kind, its because and its trigger, and the version of the workflow, at the next refusal or the next flush', async () => {
    const database = await openedOn(await onSQLite());
    const time = { now: minute + 1000 };
    const refusals = refusalsOn(database, () => time.now);
    const refuse = (refusal: Omit<Refusal, 'workflow' | 'version'>) =>
      Effect.runPromise(refusals.refuse(playbookKey, { ...ofClose, ...refusal }));

    await refuse({ reason: 'first', trigger: onEvent });
    await refuse({ reason: 'second', trigger: daily, kind: 'credits_exhausted', because: 'free_daily_limit' });
    const flushedEarly = await Effect.runPromise(refusals.flush());
    time.now = minute + aMinute + 1000;
    await refuse({ reason: 'third', trigger: daily, kind: 'credits_exhausted', because: 'free_daily_limit' });
    await refuse({ reason: 'fourth' });
    time.now = minute + 2 * aMinute;
    const flushed = await Effect.runPromise(refusals.flush());
    const flushedAgain = await Effect.runPromise(refusals.flush());
    time.now = minute + 3 * aMinute;
    await refuse({ reason: 'fifth', trigger: onEvent, kind: 'meter_unavailable' });
    const { messages } = await database.store.read(reactionsStreamOf(playbookKey, 'close'));
    const ofTheWorkflow = {
      by: 'playbook:alpha',
      definitionType: 'workflow',
      definitionName: 'close',
      definitionVersion: 3,
    };

    expect([flushedEarly, flushed, flushedAgain]).toEqual([0, 1, 0]);
    expect(messages.map(({ type, data, context }) => ({ type, data, context }))).toEqual([
      {
        type: 'reaction_refused',
        data: {
          count: 2,
          reason: 'second',
          minute: '2026-10-01T09:00:00.000Z',
          kind: 'credits_exhausted',
          because: 'free_daily_limit',
          trigger: daily,
        },
        context: { at: '2026-10-01T09:01:01.000Z', ...ofTheWorkflow },
      },
      {
        type: 'reaction_refused',
        data: { count: 2, reason: 'fourth', minute: '2026-10-01T09:01:00.000Z' },
        context: { at: '2026-10-01T09:02:00.000Z', ...ofTheWorkflow },
      },
    ]);
  });
});
