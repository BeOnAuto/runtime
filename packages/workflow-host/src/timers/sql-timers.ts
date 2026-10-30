import { statement } from '@on.auto/ledger';
import {
  DispatchFailed,
  type ArmReceipt,
  type ArmTimer,
  type OutputOrigin,
  type TimerCancelReceipt,
  type Timers,
} from '@on.auto/workflow-engine';
import { Effect, Schema } from 'effect';

import { oneRowOf, rowsOf, WholeNumber, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';

export interface DueTimer {
  readonly runKey: string;
  readonly timerId: string;
}

export interface TimerTable {
  readonly timers: Timers;
  readonly due: (now: number, limit: number) => Effect.Effect<readonly DueTimer[]>;
  readonly nextDueAt: () => Effect.Effect<number | null>;
  readonly fired: (timer: DueTimer) => Effect.Effect<void>;
  readonly postponed: (timer: DueTimer, until: number) => Effect.Effect<void>;
}

type TimerState = 'armed' | 'fired' | 'cancelled';

const StateRow = Schema.Struct({ state: Schema.Literals(['armed', 'fired', 'cancelled']) });

const DueRow = Schema.Struct({ run_key: Schema.String, timer_id: Schema.String });

const NextRow = Schema.Struct({ due: Schema.NullOr(WholeNumber) });

const ArmedByRows = Schema.Struct({ armed_by: Schema.NullOr(WholeNumber) });

const armReceipts: Readonly<Record<TimerState, ArmReceipt>> = {
  armed: 'already_armed',
  fired: 'already_armed',
  cancelled: 'refused_after_cancel',
};

const cancelReceipts: Readonly<Record<TimerState, TimerCancelReceipt>> = {
  armed: 'cancelled',
  fired: 'already_fired',
  cancelled: 'tombstoned',
};

function failedTo(output: 'arm_timer' | 'cancel_timer') {
  return ({ detail }: { readonly detail: string }) => new DispatchFailed({ output, detail });
}

function changed(rows: Effect.Effect<readonly unknown[], DatabaseFailed>): Effect.Effect<boolean, DatabaseFailed> {
  return Effect.map(rows, (found) => found.length > 0);
}

function inserted(
  database: HostDatabase,
  runKey: string,
  timer: ArmTimer,
  armedBy: number | null,
): Effect.Effect<boolean, DatabaseFailed> {
  return changed(
    database.write(
      statement`INSERT INTO workflow_timers (run_key, timer_id, state, due_at, armed_by)
        VALUES (${runKey}, ${timer.timerId}, 'armed', ${timer.dueAt}, ${armedBy})
        ON CONFLICT (run_key, timer_id) DO NOTHING RETURNING state`,
    ),
  );
}

export function armedByOf(database: HostDatabase, runKey: string, timerId: string): Effect.Effect<number | null> {
  return Effect.orDie(
    rowsOf(
      ArmedByRows,
      database.read(
        statement`SELECT armed_by FROM workflow_timers WHERE run_key = ${runKey} AND timer_id = ${timerId}`,
      ),
    ),
  ).pipe(Effect.map((rows) => rows[0]?.armed_by ?? null));
}

function stateOf(database: HostDatabase, runKey: string, timerId: string): Effect.Effect<TimerState, DatabaseFailed> {
  return oneRowOf(
    StateRow,
    database.read(statement`SELECT state FROM workflow_timers WHERE run_key = ${runKey} AND timer_id = ${timerId}`),
  ).pipe(Effect.map(({ state }) => state));
}

function cancelledFor(
  database: HostDatabase,
  runKey: string,
  timerId: string,
): Effect.Effect<TimerCancelReceipt, DatabaseFailed> {
  return Effect.gen(function* () {
    const disarmed = yield* changed(
      database.write(
        statement`UPDATE workflow_timers SET state = 'cancelled'
          WHERE run_key = ${runKey} AND timer_id = ${timerId} AND state = 'armed' RETURNING state`,
      ),
    );
    if (disarmed) {
      return 'cancelled';
    }
    const tombstoned = yield* changed(
      database.write(
        statement`INSERT INTO workflow_timers (run_key, timer_id, state) VALUES (${runKey}, ${timerId}, 'cancelled')
          ON CONFLICT (run_key, timer_id) DO NOTHING RETURNING state`,
      ),
    );
    return tombstoned ? 'tombstoned' : cancelReceipts[yield* stateOf(database, runKey, timerId)];
  });
}

function timerPort(database: HostDatabase, armed: (dueAt: number) => void): Timers {
  const armedFor = (runKey: string, timer: ArmTimer, armedBy: number | null): Effect.Effect<boolean, DatabaseFailed> =>
    Effect.tap(inserted(database, runKey, timer, armedBy), (fresh) =>
      Effect.sync(() => {
        if (fresh) {
          armed(timer.dueAt);
        }
      }),
    );
  return {
    arm: (timer, run, origin: OutputOrigin) =>
      Effect.gen(function* () {
        if (yield* armedFor(run.runId, timer, origin.version)) {
          return 'armed';
        }
        return armReceipts[yield* stateOf(database, run.runId, timer.timerId)];
      }).pipe(Effect.mapError(failedTo('arm_timer'))),
    cancel: (timer, run) =>
      cancelledFor(database, run.runId, timer.timerId).pipe(Effect.mapError(failedTo('cancel_timer'))),
    sweep: (run, timers) =>
      Effect.forEach(timers, (timer) => armedFor(run.runId, timer, null)).pipe(
        Effect.map((armedAgain: readonly boolean[]) => armedAgain.filter(Boolean).length),
        Effect.mapError(failedTo('arm_timer')),
      ),
  };
}

export function sqlTimers(database: HostDatabase, armed: (dueAt: number) => void): TimerTable {
  return {
    timers: timerPort(database, armed),
    due: (now, limit) =>
      Effect.orDie(
        rowsOf(
          DueRow,
          database.read(
            statement`SELECT run_key, timer_id FROM workflow_timers
              WHERE state = 'armed' AND due_at <= ${now} ORDER BY due_at LIMIT ${limit}`,
          ),
        ),
      ).pipe(Effect.map((rows) => rows.map(({ run_key: runKey, timer_id: timerId }) => ({ runKey, timerId })))),
    nextDueAt: () =>
      Effect.orDie(
        oneRowOf(
          NextRow,
          database.read(statement`SELECT MIN(due_at) AS due FROM workflow_timers WHERE state = 'armed'`),
        ),
      ).pipe(Effect.map(({ due }) => due)),
    fired: ({ runKey, timerId }) =>
      Effect.asVoid(
        Effect.orDie(
          database.write(
            statement`UPDATE workflow_timers SET state = 'fired'
              WHERE run_key = ${runKey} AND timer_id = ${timerId} AND state = 'armed'`,
          ),
        ),
      ),
    postponed: ({ runKey, timerId }, until) =>
      Effect.asVoid(
        Effect.orDie(
          database.write(
            statement`UPDATE workflow_timers SET due_at = ${until}
              WHERE run_key = ${runKey} AND timer_id = ${timerId} AND state = 'armed'`,
          ),
        ),
      ),
  };
}
