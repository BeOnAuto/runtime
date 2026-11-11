import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';
import { expect, it } from 'vitest';

import { rowsOf, WholeNumber } from '../database/host-database.ts';
import { reactionRunIdOf } from '../reactions/reaction-ids.ts';
import { until } from '../testing/until.ts';
import { movedClock, type MovedClock } from './moved-clock.ts';
import {
  at,
  definitionPaused,
  definitionRecorded,
  definitionResumed,
  eventTrigger,
  everyTrigger,
  published,
} from './playbook-writes.ts';
import { reactingHost, type ReactingHost, type ReactingOptions } from './reacting-host.ts';
import { unreadWhile } from './recorded-reactions.ts';

const activatedAt = Date.parse(at);

const aMinute = 60_000;

const ScheduleRow = Schema.Struct({ held_due: Schema.NullOr(WholeNumber), next_due: Schema.NullOr(WholeNumber) });

const RefusalRow = Schema.Struct({
  reason: Schema.String,
  kind: Schema.NullOr(Schema.String),
  trigger_kind: Schema.String,
  count: WholeNumber,
});

type ScheduleState = typeof ScheduleRow.Type;

type SettingsOf = () => Promise<NonNullable<ReactingOptions['settings']>>;

interface Ticking {
  readonly reacting: ReactingHost;
  readonly clock: MovedClock;
}

function minutesIn(minutes: number): number {
  return activatedAt + minutes * aMinute;
}

function isoAt(minutes: number): string {
  return new Date(minutesIn(minutes)).toISOString();
}

function startedAt(minutes: number) {
  return {
    runId: reactionRunIdOf('tick', 1, '/schedule/every', isoAt(minutes)),
    input: { schedule: { due: isoAt(minutes) } },
  };
}

async function everyFiveMinutes(
  settingsOf: SettingsOf,
  unread: Readonly<{ now: boolean }>,
  triggers: ReadonlyArray<ReturnType<typeof everyTrigger>> = [everyTrigger(5 * aMinute)],
): Promise<Ticking> {
  const clock = movedClock(activatedAt + 1000);
  const reacting = await reactingHost({ settings: await settingsOf(), clock, failure: unreadWhile(unread) });
  await definitionRecorded(reacting.database.store, { name: 'tick', version: 1, triggers });
  return { reacting, clock };
}

function scheduleReaching(
  { reacting, clock }: Readonly<Ticking>,
  minutes: number,
  holds: (row: ScheduleState) => boolean,
) {
  clock.moveTo(minutesIn(minutes));
  return until(
    async () => {
      const [row] = await Effect.runPromise(
        rowsOf(
          ScheduleRow,
          reacting.database.read(
            statement`SELECT held_due, next_due FROM workflow_subscriptions WHERE kind <> ${'event'}`,
          ),
        ),
      );
      return row;
    },
    (row) => row !== undefined && holds(row),
  );
}

async function startsOf({ reacting }: Readonly<Ticking>) {
  const starts = await until(
    () => Promise.resolve(reacting.reactions.starts()),
    (found) => found.length > 0,
  );
  return starts.map(({ runId, input }) => ({ runId, input }));
}

function refusalsOf({ reacting }: Readonly<Ticking>) {
  return Effect.runPromise(
    rowsOf(
      RefusalRow,
      reacting.database.read(statement`SELECT reason, kind, trigger_kind, count FROM workflow_reaction_refusals`),
    ),
  );
}

function heldThenStarted(settingsOf: SettingsOf) {
  it('is held and tried again a minute later, and its run is started under the id of its due time once the workflow can be read, with nothing refused', async () => {
    const unread = { now: true };
    const ticking = await everyFiveMinutes(settingsOf, unread);

    const held = await scheduleReaching(ticking, 5, (row) => row.held_due !== null);
    unread.now = false;
    const moved = await scheduleReaching(ticking, 6, (row) => row.held_due === null);

    expect([held, moved, await startsOf(ticking), await refusalsOf(ticking)]).toEqual([
      { held_due: minutesIn(5), next_due: minutesIn(6) },
      { held_due: null, next_due: minutesIn(10) },
      [startedAt(5)],
      [],
    ]);
  });
}

function heldUntilTheNext(settingsOf: SettingsOf) {
  it('is tried again each minute, never later than the next due time, and once that has come it is skipped, said with the kind content_unavailable, and the next time runs', async () => {
    const unread = { now: true };
    const ticking = await everyFiveMinutes(settingsOf, unread);
    await scheduleReaching(ticking, 5, (row) => row.held_due !== null);

    const tries = [
      await scheduleReaching(ticking, 6, (row) => row.next_due === minutesIn(7)),
      await scheduleReaching(ticking, 9.5, (row) => row.next_due === minutesIn(10)),
    ];
    unread.now = false;
    await scheduleReaching(ticking, 10, (row) => row.held_due === null);

    expect([tries, await startsOf(ticking), await refusalsOf(ticking)]).toEqual([
      [
        { held_due: minutesIn(5), next_due: minutesIn(7) },
        { held_due: minutesIn(5), next_due: minutesIn(10) },
      ],
      [startedAt(10)],
      [
        {
          reason: `The run scheduled for ${isoAt(5)} by its every schedule was skipped: the workflow could not be read from storage before the next scheduled run, at ${isoAt(10)}`,
          kind: 'content_unavailable',
          trigger_kind: 'every',
          count: 1,
        },
      ],
    ]);
  });
}

function heldThenPaused(settingsOf: SettingsOf) {
  it('is let go of when the workflow is paused, so after its resumption the next time runs and nothing is said of it', async () => {
    const unread = { now: true };
    const ticking = await everyFiveMinutes(settingsOf, unread);
    const { store } = ticking.reacting.database;
    await scheduleReaching(ticking, 5, (row) => row.held_due !== null);

    await definitionPaused(store, { name: 'tick', version: 1, when: isoAt(5.5) });
    const paused = await scheduleReaching(ticking, 5.5, (row) => row.next_due === null);
    unread.now = false;
    await definitionResumed(store, { name: 'tick', version: 1, when: isoAt(7) });
    await scheduleReaching(ticking, 7, (row) => row.next_due === minutesIn(10));
    await scheduleReaching(ticking, 10, (row) => row.next_due === minutesIn(15));

    expect([paused, await startsOf(ticking), await refusalsOf(ticking)]).toEqual([
      { held_due: null, next_due: null },
      [startedAt(10)],
      [],
    ]);
  });
}

function heldThenChanged(settingsOf: SettingsOf) {
  it('is let go of when the schedule changes, so the changed schedule runs from its own activation and nothing is said of the held time', async () => {
    const unread = { now: true };
    const ticking = await everyFiveMinutes(settingsOf, unread);
    await scheduleReaching(ticking, 5, (row) => row.held_due !== null);

    await definitionRecorded(ticking.reacting.database.store, {
      name: 'tick',
      version: 2,
      triggers: [everyTrigger(10 * aMinute)],
      when: isoAt(5.5),
    });
    const changed = await scheduleReaching(ticking, 5.5, (row) => row.held_due === null);
    unread.now = false;
    await scheduleReaching(ticking, 15.5, (row) => row.next_due === minutesIn(25.5));

    expect([changed, await startsOf(ticking), await refusalsOf(ticking)]).toEqual([
      { held_due: null, next_due: minutesIn(15.5) },
      [
        {
          runId: reactionRunIdOf('tick', 2, '/schedule/every', isoAt(15.5)),
          input: { schedule: { due: isoAt(15.5) } },
        },
      ],
      [],
    ]);
  });
}

function heldPastSeveralDueTimes(settingsOf: SettingsOf) {
  it('says the times missed after a held time it skips, when the start of the latest is held again, in the one record of their minute', async () => {
    const unread = { now: true };
    const ticking = await everyFiveMinutes(settingsOf, unread);
    await scheduleReaching(ticking, 5, (row) => row.held_due !== null);

    const heldAgain = await scheduleReaching(ticking, 17, (row) => row.held_due === minutesIn(15));
    const said = await until(
      () => refusalsOf(ticking),
      (rows) => rows.some(({ count }) => count === 2),
    );
    unread.now = false;
    await scheduleReaching(ticking, 18, (row) => row.held_due === null);

    expect([heldAgain, await startsOf(ticking), said]).toEqual([
      { held_due: minutesIn(15), next_due: minutesIn(18) },
      [startedAt(15)],
      [
        {
          reason: `The runs scheduled from ${isoAt(10)} to ${isoAt(15)} by its every schedule came due while the server was down, and only the latest ran`,
          kind: null,
          trigger_kind: 'every',
          count: 2,
        },
      ],
    ]);
  });
}

async function quartersPassed(ticking: Readonly<Ticking>, from: number, to: number): Promise<void> {
  if (from >= to) {
    return;
  }
  const next = from + 0.25;
  ticking.clock.moveTo(minutesIn(next));
  await Effect.runPromise(Effect.sleep(50));
  await quartersPassed(ticking, next, to);
}

function heldBesideAHeldEventStart(settingsOf: SettingsOf) {
  it('is held beside the start of its event trigger, which the same kind keeps trying past the sweeps that drop a start, and both start once the workflow can be read', async () => {
    const unread = { now: true };
    const ticking = await everyFiveMinutes(settingsOf, unread, [
      everyTrigger(5 * aMinute),
      eventTrigger({ type: 'com.acme.ordered' }),
    ]);
    await published(ticking.reacting.database.store, { id: 'e1', type: 'com.acme.ordered' });

    await quartersPassed(ticking, 0, 4);
    const held = await scheduleReaching(ticking, 5, (row) => row.held_due !== null);
    unread.now = false;
    await scheduleReaching(ticking, 6, (row) => row.held_due === null);
    const starts = await until(
      () => Promise.resolve(ticking.reacting.reactions.starts()),
      (found) => found.length === 2,
    );

    expect([held, starts.map(({ trigger }) => trigger.kind).toSorted(), await refusalsOf(ticking)]).toEqual([
      { held_due: minutesIn(5), next_due: minutesIn(6) },
      ['event', 'every'],
      [],
    ]);
  });
}

export function heldScheduleSuite(settingsOf: SettingsOf): void {
  heldThenStarted(settingsOf);
  heldUntilTheNext(settingsOf);
  heldThenPaused(settingsOf);
  heldThenChanged(settingsOf);
  heldPastSeveralDueTimes(settingsOf);
  heldBesideAHeldEventStart(settingsOf);
}
