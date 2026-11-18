import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';
import { expect, it } from 'vitest';

import { rowsOf } from '../database/host-database.ts';
import type { ReactionStart } from '../reactions/reaction-options.ts';
import { reactionsStreamOf, refusalsOn, type Refusal } from '../reactions/refusals.ts';
import { mostStartsAMinute, startingOn } from '../reactions/start-rates.ts';
import { openedOn, type SettingsOf } from '../testing/host-files.ts';
import { alpha } from './playbook-writes.ts';

const minute = Date.parse('2026-10-01T09:00:00.000Z');

const closing = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-0000000c105e/';

const opening = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-00000000013e/';

const StreamRow = Schema.Struct({ stream_id: Schema.String });

const aMinuteIn = () => minute + 1000;

function refusalOf(definitionKey: string, workflow: string): Refusal {
  return { definitionKey, workflow, version: 1, reason: `${workflow} was refused` };
}

function startOf(definitionKey: string, workflow: string, index: number): ReactionStart {
  return {
    org: 'acme',
    playbook: 'alpha',
    definitionKey,
    workflow,
    version: 1,
    runId: `${workflow}-${index}`,
    input: [],
    depth: 1,
    cause: `record-${index}`,
    trigger: { kind: 'event', reference: '/schedule/on' },
  };
}

function placesOfRefusals(settings: SettingsOf): void {
  it("records a refused reaction on its workflow's own stream, under the workflow's definition, and on none of its playbook", async () => {
    const database = await openedOn(await settings());
    const time = { now: minute + 1000 };
    const refusals = refusalsOn(database, 'workflow', () => time.now);
    await Effect.runPromise(refusals.refuse(alpha, refusalOf(closing, 'close')));
    await Effect.runPromise(refusals.refuse(alpha, refusalOf(opening, 'open')));
    time.now = minute + 60_000;

    const flushed = await Effect.runPromise(refusals.flush());
    const streams = await Effect.runPromise(
      rowsOf(StreamRow, database.read(statement`SELECT stream_id FROM emt_streams ORDER BY stream_id`)),
    );

    expect(flushed).toBe(2);
    expect(streams.map(({ stream_id: stream }) => stream)).toEqual(
      [reactionsStreamOf(closing, 'workflow'), reactionsStreamOf(opening, 'workflow')].toSorted(),
    );
    expect((await database.store.read(reactionsStreamOf(closing, 'workflow'))).messages).toMatchObject([
      {
        type: 'reaction_refused',
        data: { count: 1, reason: 'close was refused' },
        context: { definitionName: 'close' },
      },
    ]);
  });
}

function startsApart(settings: SettingsOf): void {
  it('keeps the starts a minute of each workflow of a playbook apart, so one at its most holds back no other', async () => {
    const database = await openedOn(await settings());
    const started: string[] = [];
    const starting = startingOn(
      database,
      (start) =>
        Effect.sync(() => {
          started.push(start.runId);
        }),
      refusalsOn(database, 'workflow', aMinuteIn),
      aMinuteIn,
    );
    const starts = [
      ...Array.from({ length: mostStartsAMinute + 1 }, (_, index) => startOf(closing, 'close', index)),
      startOf(opening, 'open', 0),
    ];

    await Effect.runPromise(Effect.forEach(starts, (start) => starting.start(alpha, start), { discard: true }));

    expect([started.length, started.includes('open-0'), started.includes(`close-${mostStartsAMinute}`)]).toEqual([
      mostStartsAMinute + 1,
      true,
      false,
    ]);
  });
}

export function refusalPlacesSuite(settings: SettingsOf): void {
  placesOfRefusals(settings);
  startsApart(settings);
}
