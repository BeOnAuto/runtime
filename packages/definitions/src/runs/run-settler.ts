import {
  PlaybookIdSchema,
  NotFound,
  OrgIdSchema,
  playbookCallerOf,
  streamPrefixOfPlaybook,
  type Conflict,
  type Lineage,
  type Rejection,
  type SettledRejection,
  type Settlement,
  type StreamState,
  type StreamWriter,
} from '@on.auto/operations';
import { DateTime, Effect, Schema } from 'effect';

import { settledWithTheMeter } from '../metering/run-meter.ts';
import { withinResultLimit } from './recorded-size.ts';
import type { RunResult, RunSettlement } from './run-commands.ts';
import { runDecider, runDeciderAsRead, runStreamNameOf } from './run-decider.ts';
import { runOf } from './run-lookup.ts';
import { startedRunOf, type RunStreamState } from './run-state.ts';
import type { RunRejection, Run } from './run.ts';

export type { Settlement } from '@on.auto/operations';

export interface RunStreamAddress {
  readonly org: string;
  readonly playbook: string;
  readonly id: string;
}

export type SettleRun = (
  run: RunStreamAddress,
  settlement: Settlement,
  lineage?: Lineage,
) => Effect.Effect<Run, NotFound | Conflict>;

type SettleAsRead = (
  run: RunStreamAddress,
  settlement: Settlement,
  readAt: number,
  lineage?: Lineage,
) => Effect.Effect<Run, NotFound | Conflict>;

type SettledOn = (
  stream: string,
  command: RunSettlement,
  lineage: Lineage | undefined,
) => Effect.Effect<StreamState<RunStreamState>, Rejection<'not_found' | 'conflict' | 'cancelled'>>;

const isWellFormed = Schema.is(
  Schema.Struct({ org: OrgIdSchema, playbook: PlaybookIdSchema, id: Schema.String.check(Schema.isUUID()) }),
);

const decodeSuccess = Schema.decodeUnknownEffect(Schema.Struct({ output: Schema.Json, record: Schema.JsonObject }));

const failure: RunResult = { type: 'run_failed', data: {} };

function rejectionOf(settlement: SettledRejection): RunRejection {
  if (settlement.reason === 'invalid_input') {
    return { reason: settlement.reason, detail: settlement.detail, issues: settlement.issues ?? [] };
  }
  if (settlement.reason === 'unavailable') {
    const { reason, detail, kind, because } = settlement;
    return { reason, detail, ...(kind === undefined ? {} : { kind }), ...(because === undefined ? {} : { because }) };
  }
  if (settlement.reason === 'conflict') {
    const { reason, detail, kind, because } = settlement;
    return { reason, detail, ...(kind === undefined ? {} : { kind }), ...(because === undefined ? {} : { because }) };
  }
  if (settlement.reason === 'unanswered') {
    const { reason, detail, kind } = settlement;
    return { reason, detail, kind };
  }
  const { reason, detail, kind } = settlement;
  return { reason, detail, kind };
}

function rejectedWith(settlement: SettledRejection): Effect.Effect<RunResult> {
  const { record } = settlement;
  const rejection = rejectionOf(settlement);
  return record === undefined
    ? Effect.succeed({ type: 'run_rejected', data: { rejection } })
    : Effect.as(withinResultLimit(record), { type: 'run_rejected', data: { rejection, record } });
}

const noSuchRun = new NotFound({ detail: 'There is no such run in this playbook' });

interface SettledRun {
  readonly stream: string;
  readonly runId: string;
}

function streamOf(address: RunStreamAddress): Effect.Effect<string, NotFound> {
  return isWellFormed(address)
    ? Effect.succeed(`${streamPrefixOfPlaybook(address)}${runStreamNameOf(address.id.toLowerCase())}`)
    : Effect.fail(noSuchRun);
}

function playbookStreamOf(address: RunStreamAddress): Effect.Effect<string, NotFound> {
  return isWellFormed(address) ? Effect.succeed(runStreamNameOf(address.id.toLowerCase())) : Effect.fail(noSuchRun);
}

function resultOf(settlement: Settlement): Effect.Effect<RunResult> {
  if (settlement.status === 'succeeded') {
    return decodeSuccess({ output: settlement.output, record: settlement.record ?? {} }).pipe(
      Effect.orDie,
      Effect.tap(({ output, record }) => withinResultLimit(output, record)),
      Effect.map(({ output, record }): RunResult => ({ type: 'run_succeeded', data: { output, record } })),
    );
  }
  if (settlement.status === 'rejected') {
    return rejectedWith(settlement);
  }
  const { incident } = settlement;
  return Effect.succeed(incident === undefined ? failure : { type: 'run_failed', data: { incident } });
}

function settledOnLatest(ledger: StreamWriter): SettledOn {
  return (stream, command, lineage) => ledger.execute(stream, runDecider, command, lineage);
}

function settledOnRead(ledger: StreamWriter, readAt: number): SettledOn {
  return (stream, command, lineage) =>
    Effect.map(ledger.execute(stream, runDeciderAsRead, { readAt, command }, lineage), ({ state, version }) => ({
      state: state.state,
      version,
    }));
}

function settlerOver(
  settledOn: SettledOn,
  streamNamed: (address: RunStreamAddress) => Effect.Effect<string, NotFound>,
): SettleRun {
  const settle = Effect.fnUntraced(function* (target: SettledRun, result: RunResult, by: string, lineage?: Lineage) {
    const at = DateTime.formatIso(yield* DateTime.now);
    return yield* settledOn(target.stream, { type: 'settle', result, runId: target.runId, by, at }, lineage).pipe(
      Effect.catchTag('cancelled', Effect.die),
    );
  });
  return (run, settlement, lineage) =>
    Effect.gen(function* () {
      const target = { stream: yield* streamNamed(run), runId: run.id.toLowerCase() };
      const by = settlement.by ?? playbookCallerOf(run).id;
      const result = yield* resultOf(settlement).pipe(
        Effect.tapDefect(() => Effect.ignore(settle(target, failure, by, lineage))),
      );
      const { state } = yield* settle(target, result, by, lineage);
      yield* settledWithTheMeter(run, target.runId, startedRunOf(state));
      return yield* runOf(target.runId, state);
    });
}

export function runSettler(ledger: StreamWriter): SettleRun {
  return settlerOver(settledOnLatest(ledger), streamOf);
}

export function runSettlerAsRead(ledger: StreamWriter): SettleAsRead {
  return (run, settlement, readAt, lineage) =>
    settlerOver(settledOnRead(ledger, readAt), streamOf)(run, settlement, lineage);
}

export function playbookBoundSettler(writer: StreamWriter): SettleRun {
  return settlerOver(settledOnLatest(writer), playbookStreamOf);
}
