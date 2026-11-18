import type { SettleRun } from '@on.auto/definitions';
import { statement } from '@on.auto/ledger';
import { NotFound, SettlementSchema, type Lineage, type Settlement } from '@on.auto/operations';
import { DispatchFailed, type RecordStore, type SettleReceipt } from '@on.auto/workflow-engine';
import { Cause, Effect, Equal, Option, Predicate, Schema } from 'effect';

import { rowsOf, WholeNumber, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import type { HostNote } from '../host/host-reports.ts';
import { lineageOfSettlement } from '../runs/run-lineage.ts';
import { knownRunOf } from '../runs/run-places.ts';
import { attempted, isBackingOff, settleAttemptsBeforeBackingOff, settleBackOffMs } from './settle-attempts.ts';

export interface RecordStoreParts {
  readonly settle: SettleRun;
  readonly note: (note: HostNote) => Effect.Effect<void>;
  readonly now: () => number;
}

const mostDueRunsInOneSweep = 1024;

const settledVersion = Number.MAX_SAFE_INTEGER;

const SettlementText = Schema.fromJsonString(Schema.toCodecJson(SettlementSchema));

const encodeSettlement = Schema.encodeSync(SettlementText);

const SettlementRow = Schema.Struct({
  settlement: Schema.NullOr(SettlementText),
  attempts: WholeNumber,
  last_attempt_at: Schema.NullOr(WholeNumber),
});

const RunRow = Schema.Struct({ run_key: Schema.String });

type Receipt = Effect.Effect<SettleReceipt, DatabaseFailed | DispatchFailed>;

type NotedRun = Extract<HostNote, { readonly kind: 'settle_backing_off' }>['run'];

interface Settling {
  readonly database: HostDatabase;
  readonly parts: RecordStoreParts;
  readonly runKey: string;
  readonly settlement: Settlement;
  readonly lineage: Lineage;
}

function recorded(database: HostDatabase, runKey: string, settlement: Settlement): Effect.Effect<void, DatabaseFailed> {
  return Effect.asVoid(
    Effect.all([
      database.write(
        statement`INSERT INTO workflow_settlements (run_key, settlement) VALUES (${runKey}, ${encodeSettlement(settlement)})
          ON CONFLICT (run_key) DO UPDATE SET settlement = excluded.settlement`,
      ),
      database.write(
        statement`INSERT INTO workflow_due (run_key, version, next_due_at) VALUES (${runKey}, ${settledVersion}, NULL)
          ON CONFLICT (run_key) DO UPDATE SET version = excluded.version, next_due_at = NULL`,
      ),
    ]),
  );
}

function detailOf(failure: unknown): string {
  return Predicate.hasProperty(failure, 'detail') && Predicate.isString(failure.detail)
    ? failure.detail
    : String(failure);
}

function failedAttempt({ database, parts, runKey }: Settling, run: NotedRun, detail: string): Receipt {
  return Effect.gen(function* () {
    const attempts = yield* attempted(database, runKey, parts.now());
    if (attempts === settleAttemptsBeforeBackingOff) {
      yield* parts.note({ kind: 'settle_backing_off', run, attempts, detail });
    }
    return yield* new DispatchFailed({ output: 'settle', detail });
  });
}

function succeeded({ database, parts, runKey, settlement }: Settling, run: NotedRun, attemptsBefore: number): Receipt {
  return Effect.gen(function* () {
    yield* recorded(database, runKey, settlement);
    if (attemptsBefore >= settleAttemptsBeforeBackingOff) {
      yield* parts.note({ kind: 'settled_after_back_off', run, attempts: attemptsBefore + 1 });
    }
    return 'recorded' as const;
  });
}

function settledAs(settling: Settling, run: NotedRun & { readonly playbook: string }, attemptsBefore: number): Receipt {
  const { org, playbook, definition, runId } = run;
  const noted = { org, definition, runId };
  return settling.parts.settle({ org, playbook, id: runId }, settling.settlement, settling.lineage).pipe(
    Effect.matchCauseEffect({
      onSuccess: () => succeeded(settling, noted, attemptsBefore),
      onFailure: (cause: Cause.Cause<unknown>) =>
        Option.exists(Cause.findErrorOption(cause), (error) => error instanceof NotFound)
          ? Effect.succeed('unknown_run' as const)
          : failedAttempt(settling, noted, detailOf(Cause.squash(cause))),
    }),
    Effect.tap((receipt: SettleReceipt) => Effect.annotateCurrentSpan('auto.on.settle.receipt', receipt)),
    Effect.withSpan('settle', {
      attributes: {
        'auto.on.org': org,
        'auto.on.definition.id': definition,
        'auto.on.run_id': runId,
        'auto.on.settlement.status': settling.settlement.status,
        'auto.on.settle.attempts_before': attemptsBefore,
      },
    }),
  );
}

function asDispatchFailure(failure: unknown): DispatchFailed {
  return failure instanceof DispatchFailed
    ? failure
    : new DispatchFailed({ output: 'settle', detail: detailOf(failure) });
}

function settledOnce(settling: Settling): Receipt {
  const { database, parts, runKey, settlement } = settling;
  return Effect.gen(function* () {
    const [earlier] = yield* rowsOf(
      SettlementRow,
      database.read(
        statement`SELECT settlement, attempts, last_attempt_at FROM workflow_settlements WHERE run_key = ${runKey}`,
      ),
    );
    if (earlier !== undefined && earlier.settlement !== null) {
      return Equal.equals(earlier.settlement, settlement) ? 'already_recorded' : 'settled_otherwise';
    }
    const attemptsBefore = earlier?.attempts ?? 0;
    if (isBackingOff(attemptsBefore, earlier?.last_attempt_at ?? null, parts.now())) {
      return yield* new DispatchFailed({
        output: 'settle',
        detail: `The settlement failed ${attemptsBefore} times, so it is tried again once every ${settleBackOffMs} ms`,
      });
    }
    const run = yield* knownRunOf(database, runKey);
    return run === undefined ? 'unknown_run' : yield* settledAs(settling, run, attemptsBefore);
  });
}

export function ledgerRecordStore(database: HostDatabase, parts: RecordStoreParts): RecordStore {
  return {
    settle: ({ runId: runKey, settlement }, run, origin) =>
      settledOnce({ database, parts, runKey, settlement, lineage: lineageOfSettlement(run, origin) }).pipe(
        Effect.mapError(asDispatchFailure),
      ),
    noteDue: ({ runId: runKey, version, nextDueAt }) =>
      Effect.asVoid(
        database.write(
          statement`INSERT INTO workflow_due (run_key, version, next_due_at) VALUES (${runKey}, ${version}, ${nextDueAt})
            ON CONFLICT (run_key) DO UPDATE SET version = excluded.version, next_due_at = excluded.next_due_at
            WHERE workflow_due.version <= excluded.version`,
        ),
      ).pipe(
        Effect.mapError(
          ({ detail }: { readonly detail: string }) => new DispatchFailed({ output: 'note_due', detail }),
        ),
      ),
    dueRuns: (before) =>
      Effect.orDie(
        rowsOf(
          RunRow,
          database.read(
            statement`SELECT run_key FROM workflow_due WHERE next_due_at IS NOT NULL AND next_due_at < ${before}
              ORDER BY next_due_at LIMIT ${mostDueRunsInOneSweep}`,
          ),
        ),
      ).pipe(Effect.map((rows) => rows.map(({ run_key: runKey }) => runKey))),
  };
}
