import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { rowsOf } from '../database/host-database.ts';
import { movedClock, type MovedClock } from '../reaction-testing/moved-clock.ts';
import {
  at,
  cronTrigger,
  everyTrigger,
  definitionRecordAt,
  definitionRecorded,
} from '../reaction-testing/playbook-writes.ts';
import { reactingHost, type ReactingHost } from '../reaction-testing/reacting-host.ts';
import { refusedWhile, type FailingStart } from '../reaction-testing/recorded-reactions.ts';
import { reactionRunIdOf } from '../reactions/reaction-ids.ts';
import { until } from '../testing/until.ts';

const activatedAt = Date.parse(at);

const aMinute = 60_000;

const RefusalRow = Schema.Struct({ reason: Schema.String });

interface Ticking {
  readonly reacting: ReactingHost;
  readonly clock: MovedClock;
}

function isoAt(minutes: number): string {
  return new Date(activatedAt + minutes * aMinute).toISOString();
}

async function ticking(failure?: FailingStart): Promise<Ticking> {
  const clock = movedClock(activatedAt + 1000);
  const reacting = await reactingHost({ clock, ...(failure === undefined ? {} : { failure }) });
  await definitionRecorded(reacting.database.store, {
    name: 'tick',
    version: 1,
    triggers: [everyTrigger(aMinute)],
  });
  return { reacting, clock };
}

async function startsReaching(reacting: ReactingHost, count: number) {
  const starts = await until(
    () => Promise.resolve(reacting.reactions.starts()),
    (found) => found.length >= count,
  );
  return [...starts];
}

function refusalsOf(reacting: ReactingHost) {
  return until(
    () =>
      Effect.runPromise(
        rowsOf(RefusalRow, reacting.database.read(statement`SELECT reason FROM workflow_reaction_refusals`)),
      ),
    (found) => found.length > 0,
  );
}

describe('a workflow whose every schedule is due every minute', () => {
  it('is started at each due time, anchored at its activation, under an id of its due time, caused by its activation', async () => {
    const { reacting, clock } = await ticking();

    clock.moveTo(activatedAt + aMinute);
    const first = await startsReaching(reacting, 1);
    clock.moveTo(activatedAt + 2 * aMinute + 30_000);
    const both = await startsReaching(reacting, 2);

    expect(first).toEqual([
      {
        org: 'acme',
        playbook: 'alpha',
        workflow: 'tick',
        version: 1,
        runId: reactionRunIdOf('tick', 1, '/schedule/every', isoAt(1)),
        input: { schedule: { due: isoAt(1) } },
        depth: 1,
        cause: definitionRecordAt(1),
        trigger: { kind: 'every', reference: '/schedule/every' },
      },
    ]);
    expect(both.map(({ input }) => input)).toEqual([{ schedule: { due: isoAt(1) } }, { schedule: { due: isoAt(2) } }]);
  });
});

describe('the due times of a schedule', () => {
  it('are skipped while the run of the time before still runs, and the skip is said', async () => {
    const { reacting, clock } = await ticking();
    clock.moveTo(activatedAt + aMinute);
    await startsReaching(reacting, 1);
    const running = `acme/alpha/${reactionRunIdOf('tick', 1, '/schedule/every', isoAt(1))}`;
    await Effect.runPromise(
      reacting.database.write(statement`INSERT INTO workflow_runs (run_key, stream_id) VALUES (${running}, ${'s'})`),
    );

    clock.moveTo(activatedAt + 2 * aMinute);
    const refusals = await refusalsOf(reacting);

    await Effect.runPromise(
      reacting.database.write(statement`UPDATE workflow_runs SET ended_at = 3 WHERE run_key = ${running}`),
    );
    clock.moveTo(activatedAt + 3 * aMinute);
    const starts = await startsReaching(reacting, 2);

    expect([starts.map(({ input }) => input), refusals]).toEqual([
      [{ schedule: { due: isoAt(1) } }, { schedule: { due: isoAt(3) } }],
      [
        {
          reason: `The run its every schedule had due at ${isoAt(2)} was skipped: the run its every schedule started before still runs`,
        },
      ],
    ]);
  });
});

describe('a due time of a schedule', () => {
  it('whose run the playbook refuses is said, and the schedule goes on', async () => {
    const refusing = { now: true };
    const { reacting, clock } = await ticking(refusedWhile(refusing));
    clock.moveTo(activatedAt + aMinute);
    const refusals = await refusalsOf(reacting);
    refusing.now = false;

    clock.moveTo(activatedAt + 2 * aMinute);
    const starts = await startsReaching(reacting, 1);

    expect([refusals, starts.map(({ input }) => input)]).toEqual([
      [
        {
          reason: `The run its every schedule had due at ${isoAt(1)} could not be started: The playbook refused the start`,
        },
      ],
      [{ schedule: { due: isoAt(2) } }],
    ]);
  });

  it('missed while the server was down runs only the latest, and the missed ones are said', async () => {
    const { reacting, clock } = await ticking();

    clock.moveTo(activatedAt + 5 * aMinute + 10_000);
    const starts = await startsReaching(reacting, 1);
    const refusals = await refusalsOf(reacting);

    expect([starts.map(({ input }) => input), refusals]).toEqual([
      [{ schedule: { due: isoAt(5) } }],
      [
        {
          reason: `The runs its every schedule had due from ${isoAt(1)} to ${isoAt(5)} came while the server was down, and only the latest ran`,
        },
      ],
    ]);
  });
});

describe('a workflow with a cron schedule', () => {
  it('is started at the times of its five fields, in UTC', async () => {
    const clock = movedClock(activatedAt + 1000);
    const reacting = await reactingHost({ clock });
    await definitionRecorded(reacting.database.store, {
      name: 'nightly',
      version: 1,
      triggers: [cronTrigger('30 2 * * *')],
    });

    clock.moveTo(Date.parse('2026-10-02T02:30:00.000Z'));
    const starts = await startsReaching(reacting, 1);

    expect(starts.map(({ input }) => input)).toEqual([{ schedule: { due: '2026-10-02T02:30:00.000Z' } }]);
  });
});
