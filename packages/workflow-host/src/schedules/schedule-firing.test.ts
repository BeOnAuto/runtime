import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { rowsOf } from '../database/host-database.ts';
import {
  at,
  cronTrigger,
  everyTrigger,
  definitionKeyNamed,
  definitionRecordAt,
} from '../reaction-testing/playbook-writes.ts';
import { refusedWhile, rejectedWith, type FailingStart } from '../reaction-testing/recorded-reactions.ts';
import { keptDefinition, steppedReacting, type SteppedReacting } from '../reaction-testing/stepped-reactions.ts';
import { reactionRunIdOf } from '../reactions/reaction-ids.ts';
import { fewSweeps } from '../testing/stepped-clock.ts';

const activatedAt = Date.parse(at);

const aMinute = 60_000;

const RefusalRow = Schema.Struct({
  reason: Schema.String,
  kind: Schema.NullOr(Schema.String),
  because: Schema.NullOr(Schema.String),
  trigger_kind: Schema.String,
  trigger_reference: Schema.String,
});

const ofTheSchedule = { trigger_kind: 'every', trigger_reference: '/schedule/every' };

const uncoded = { kind: null, because: null, ...ofTheSchedule };

type Ticking = SteppedReacting;

async function keeping(
  name: string,
  triggers: Parameters<typeof keptDefinition>[1]['triggers'],
  failure?: FailingStart,
): Promise<Ticking> {
  const ticked = await steppedReacting(failure === undefined ? {} : { failure });
  await keptDefinition(ticked, { name, version: 1, triggers });
  return ticked;
}

function isoAt(minutes: number): string {
  return new Date(activatedAt + minutes * aMinute).toISOString();
}

function ticking(failure?: FailingStart): Promise<Ticking> {
  return keeping('tick', [everyTrigger(aMinute)], failure);
}

async function startsReaching({ reacting, sweeps }: Ticking, count: number) {
  const starts = await sweeps.until(
    () => reacting.reactions.starts(),
    (found) => found.length >= count,
    fewSweeps,
  );
  return [...starts];
}

function refusalsOf({ reacting, sweeps }: Ticking) {
  return sweeps.until(
    () =>
      Effect.runPromise(
        rowsOf(
          RefusalRow,
          reacting.database.read(
            statement`SELECT reason, kind, because, trigger_kind, trigger_reference FROM workflow_reaction_refusals`,
          ),
        ),
      ),
    (found) => found.length > 0,
    fewSweeps,
  );
}

describe('a workflow whose every schedule is due every minute', () => {
  it('is started at each due time, anchored at its activation, under an id of its due time, caused by its activation', async () => {
    const ticked = await ticking();
    const { clock } = ticked;

    clock.moveTo(activatedAt + aMinute);
    const first = await startsReaching(ticked, 1);
    clock.moveTo(activatedAt + 2 * aMinute + 30_000);
    const both = await startsReaching(ticked, 2);

    expect(first).toEqual([
      {
        org: 'acme',
        playbook: 'alpha',
        definitionKey: definitionKeyNamed('tick'),
        workflow: 'tick',
        version: 1,
        runId: reactionRunIdOf(definitionKeyNamed('tick'), 1, '/schedule/every', isoAt(1)),
        input: { schedule: { due: isoAt(1) } },
        depth: 1,
        cause: definitionRecordAt('tick', 1),
        trigger: { kind: 'every', reference: '/schedule/every' },
      },
    ]);
    expect(both.map(({ input }) => input)).toEqual([{ schedule: { due: isoAt(1) } }, { schedule: { due: isoAt(2) } }]);
  });
});

describe('the due times of a schedule', () => {
  it('are skipped while the run of the time before still runs, and the skip is said', async () => {
    const ticked = await ticking();
    const { reacting, clock } = ticked;
    clock.moveTo(activatedAt + aMinute);
    await startsReaching(ticked, 1);
    const running = `acme/alpha/${reactionRunIdOf(definitionKeyNamed('tick'), 1, '/schedule/every', isoAt(1))}`;
    await Effect.runPromise(
      reacting.database.write(statement`INSERT INTO workflow_runs (run_key, stream_id) VALUES (${running}, ${'s'})`),
    );

    clock.moveTo(activatedAt + 2 * aMinute);
    const refusals = await refusalsOf(ticked);

    await Effect.runPromise(
      reacting.database.write(statement`UPDATE workflow_runs SET ended_at = 3 WHERE run_key = ${running}`),
    );
    clock.moveTo(activatedAt + 3 * aMinute);
    const starts = await startsReaching(ticked, 2);

    expect([starts.map(({ input }) => input), refusals]).toEqual([
      [{ schedule: { due: isoAt(1) } }, { schedule: { due: isoAt(3) } }],
      [
        {
          reason: `The run scheduled for ${isoAt(2)} by its every schedule was skipped: the run it started before is still running`,
          ...uncoded,
        },
      ],
    ]);
  });
});

describe('a due time of a schedule', () => {
  it('whose run the playbook refuses is said, and the schedule goes on', async () => {
    const refusing = { now: true };
    const ticked = await ticking(refusedWhile(refusing));
    const { clock } = ticked;
    clock.moveTo(activatedAt + aMinute);
    const refusals = await refusalsOf(ticked);
    refusing.now = false;

    clock.moveTo(activatedAt + 2 * aMinute);
    const starts = await startsReaching(ticked, 1);

    expect([refusals, starts.map(({ input }) => input)]).toEqual([
      [
        {
          reason: `The run scheduled for ${isoAt(1)} by its every schedule could not be started: The playbook refused the start`,
          ...uncoded,
        },
      ],
      [{ schedule: { due: isoAt(2) } }],
    ]);
  });
});

describe('a due time of a schedule whose run the playbook rejects', () => {
  it('is said with the kind and because of the rejection and the trigger', async () => {
    const ticked = await ticking(
      rejectedWith({
        detail: 'The org has used today’s Free credits',
        kind: 'credits_exhausted',
        because: 'free_daily_limit',
      }),
    );
    const { clock } = ticked;

    clock.moveTo(activatedAt + aMinute);
    const refusals = await refusalsOf(ticked);

    expect(refusals).toEqual([
      {
        reason: `The run scheduled for ${isoAt(1)} by its every schedule could not be started: The org has used today’s Free credits`,
        kind: 'credits_exhausted',
        because: 'free_daily_limit',
        ...ofTheSchedule,
      },
    ]);
  });
});

describe('the due times of a schedule missed while the server was down', () => {
  it('run only the latest, and the missed ones are said', async () => {
    const ticked = await ticking();
    const { clock } = ticked;

    clock.moveTo(activatedAt + 5 * aMinute + 10_000);
    const starts = await startsReaching(ticked, 1);
    const refusals = await refusalsOf(ticked);

    expect([starts.map(({ input }) => input), refusals]).toEqual([
      [{ schedule: { due: isoAt(5) } }],
      [
        {
          reason: `The runs scheduled from ${isoAt(1)} to ${isoAt(5)} by its every schedule came due while the server was down, and only the latest ran`,
          ...uncoded,
        },
      ],
    ]);
  });
});

describe('a workflow with a cron schedule', () => {
  it('is started at the times of its five fields, in UTC', async () => {
    const ticked = await keeping('nightly', [cronTrigger('30 2 * * *')]);
    const { clock } = ticked;

    clock.moveTo(Date.parse('2026-10-02T02:30:00.000Z'));
    const starts = await startsReaching(ticked, 1);

    expect(starts.map(({ input }) => input)).toEqual([{ schedule: { due: '2026-10-02T02:30:00.000Z' } }]);
  });
});

describe('a schedule whose workflow holds no name in the ledger', () => {
  it('starts nothing, and its row is deleted when it comes due', async () => {
    const { reacting, clock, sweeps } = await steppedReacting();
    const nameless = 'definition/acme/0190a5b6-0000-7000-8000-000000000000/';
    await Effect.runPromise(
      reacting.database.write(
        statement`INSERT INTO workflow_subscriptions
            (definition_key, reference, playbook_key, version, kind, rule, activated_by, activated_at, next_due)
          VALUES (${nameless}, '/schedule/every', 'playbook/acme/alpha/', 1, 'every',
            ${JSON.stringify(everyTrigger(aMinute))}, 'nobody', ${activatedAt}, ${activatedAt + aMinute})`,
      ),
    );
    clock.moveTo(activatedAt + aMinute);
    const rows = await sweeps.until(
      () =>
        Effect.runPromise(
          rowsOf(
            Schema.Struct({ reference: Schema.String }),
            reacting.database.read(statement`SELECT reference FROM workflow_subscriptions`),
          ),
        ),
      (found) => found.length === 0,
      fewSweeps,
    );

    expect(rows).toEqual([]);
    expect(reacting.reactions.starts()).toEqual([]);
  });
});
