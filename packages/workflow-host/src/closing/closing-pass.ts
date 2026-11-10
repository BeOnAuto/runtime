import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import { closedRun, closingBounds } from './closed-runs.ts';

export interface ClosingPassAsked {
  readonly now: number;
  readonly after: string;
  readonly dryRun: boolean;
  readonly quietMs?: number;
  readonly most?: number;
}

export interface ClosingPass {
  readonly examined: number;
  readonly closed: number;
  readonly calls: number;
  readonly bytes: number;
  readonly endsRecovered: number;
  readonly alreadyClosed: number;
  readonly going: number;
  readonly dispatchBehind: number;
  readonly unsettled: number;
  readonly callsOpen: number;
  readonly tooRecent: number;
  readonly logMissing: number;
  readonly next?: string;
}

type Held = 'alreadyClosed' | 'going' | 'dispatchBehind' | 'unsettled' | 'callsOpen' | 'tooRecent' | 'logMissing';

const FactsRow = Schema.Struct({
  run_key: Schema.String,
  stream_id: Schema.String,
  ended_at: Schema.NullOr(WholeNumber),
  ended_time: Schema.NullOr(WholeNumber),
  closed_at: Schema.NullOr(WholeNumber),
  dispatched_through: WholeNumber,
  logged_through: Schema.NullOr(WholeNumber),
  settled: WholeNumber,
  open_calls: WholeNumber,
  calls: WholeNumber,
  bytes: WholeNumber,
});

type Facts = typeof FactsRow.Type;

const nothingCounted: ClosingPass = {
  examined: 0,
  closed: 0,
  calls: 0,
  bytes: 0,
  endsRecovered: 0,
  alreadyClosed: 0,
  going: 0,
  dispatchBehind: 0,
  unsettled: 0,
  callsOpen: 0,
  tooRecent: 0,
  logMissing: 0,
};

function factsAfter(database: HostDatabase, after: string, most: number) {
  return rowsOf(
    FactsRow,
    database.read(
      statement`SELECT run.run_key, run.stream_id, run.ended_at, run.ended_time, run.closed_at, run.dispatched_through,
          stream.stream_position AS logged_through,
          CASE WHEN EXISTS (
            SELECT 1 FROM workflow_settlements AS settled
            WHERE settled.run_key = run.run_key AND settled.settlement IS NOT NULL
          ) THEN 1 ELSE 0 END AS settled,
          (SELECT COUNT(*) FROM workflow_calls AS open
            WHERE open.run_key = run.run_key AND open.state <> 'closed'
              AND (open.state IN ('running', 'waiting') OR (open.state = 'answered' AND open.delivered = 0))
          ) AS open_calls,
          (SELECT COUNT(*) FROM workflow_calls AS kept WHERE kept.run_key = run.run_key AND kept.state <> 'closed')
            AS calls,
          (SELECT COALESCE(SUM(COALESCE(octet_length(kept.call), 0) + COALESCE(octet_length(kept.attributes), 0)
              + COALESCE(octet_length(kept.result), 0)), 0)
            FROM workflow_calls AS kept WHERE kept.run_key = run.run_key AND kept.state <> 'closed') AS bytes
        FROM workflow_runs AS run
        LEFT JOIN emt_streams AS stream ON stream.stream_id = run.stream_id AND stream.is_archived = FALSE
        WHERE run.run_key > ${after}
        ORDER BY run.run_key
        LIMIT ${most}`,
    ),
  );
}

interface Ended {
  readonly endedAt: number;
}

function endedAtOf({ ended_at: endedAt, settled, logged_through: loggedThrough }: Facts): number | null {
  return endedAt ?? (settled === 1 ? loggedThrough : null);
}

function standingOf(facts: Facts): Held | Ended {
  const endedAt = endedAtOf(facts);
  if (facts.closed_at !== null) {
    return 'alreadyClosed';
  }
  if (endedAt === null) {
    return 'going';
  }
  if (facts.dispatched_through < endedAt) {
    return 'dispatchBehind';
  }
  if (facts.settled !== 1) {
    return 'unsettled';
  }
  return facts.open_calls > 0 ? 'callsOpen' : { endedAt };
}

function counted(pass: ClosingPass, held: Held): ClosingPass {
  return { ...pass, [held]: pass[held] + 1 };
}

function closedIn(pass: ClosingPass, facts: Facts): ClosingPass {
  return {
    ...pass,
    closed: pass.closed + 1,
    calls: pass.calls + facts.calls,
    bytes: pass.bytes + facts.bytes,
    endsRecovered: pass.endsRecovered + (facts.ended_at === null ? 1 : 0),
  };
}

function endedTimeOf(database: HostDatabase, facts: Facts, now: number): Effect.Effect<number | null> {
  return facts.ended_time === null
    ? Effect.map(
        Effect.promise(() => database.store.ageOfLastAppend(facts.stream_id)),
        (age) => (Number.isFinite(age) ? now - age : null),
      )
    : Effect.succeed(facts.ended_time);
}

function passedOver(
  database: HostDatabase,
  { now, dryRun, quietMs = closingBounds.quietMs }: ClosingPassAsked,
): (pass: ClosingPass, facts: Facts) => Effect.Effect<ClosingPass, DatabaseFailed> {
  return (pass, facts) =>
    Effect.gen(function* () {
      const standing = standingOf(facts);
      if (typeof standing === 'string') {
        return counted(pass, standing);
      }
      const { endedAt } = standing;
      const endedTime = yield* endedTimeOf(database, facts, now);
      if (endedTime === null) {
        return counted(pass, 'logMissing');
      }
      if (endedTime > now - quietMs) {
        return counted(pass, 'tooRecent');
      }
      if (dryRun) {
        return closedIn(pass, facts);
      }
      const closed = yield* closedRun(database, { runKey: facts.run_key, endedAt, endedTime }, now);
      return closed ? closedIn(pass, facts) : counted(pass, 'callsOpen');
    });
}

export function endedRunsClosed(
  database: HostDatabase,
  asked: ClosingPassAsked,
): Effect.Effect<ClosingPass, DatabaseFailed> {
  const most = asked.most ?? closingBounds.runsInAPass;
  return Effect.gen(function* () {
    const examined = yield* factsAfter(database, asked.after, most);
    const passed = passedOver(database, asked);
    let pass: ClosingPass = { ...nothingCounted, examined: examined.length };
    for (const facts of examined) {
      pass = yield* passed(pass, facts);
    }
    const last = examined.at(-1);
    return last !== undefined && examined.length === most ? { ...pass, next: last.run_key } : pass;
  });
}
