import {
  PlaybookIdSchema,
  NotFound,
  OrgIdSchema,
  playbookCallerOf,
  streamPrefixOfPlaybook,
  type Conflict,
  type Lineage,
  type SettledRejection,
  type Settlement as SettlementOfAnOperation,
  type ContentKeeper,
  type StreamReader,
  type StreamWriter,
  type Unavailable,
} from '@on.auto/operations';
import { outputPayloadOf, payloadMembers, type Payload } from '@on.auto/operations/payloads';
import { DateTime, Effect, Schema, Struct } from 'effect';

import {
  outputsAsGiven,
  outputsKeptIn,
  resultedAlone,
  settledComparing,
  type Resulted,
  type SettledOutputs,
  type WrittenOutput,
} from '../payloads/settled-outputs.ts';
import { jsonBytesOf, payloadBytesOf, withinResultBytes, withinResultLimit } from './recorded-size.ts';
import type { RunResult } from './run-commands.ts';
import { runStreamNameOf, settledOnLatest, settledOnRead, type SettledOn } from './run-decider.ts';
import type { Settlement } from './run-events.ts';
import { runOf } from './run-lookup.ts';
import { causeOf, type RunRejection, type SettledRun } from './run.ts';

export type { Settlement } from './run-events.ts';

export interface RunStreamAddress {
  readonly org: string;
  readonly playbook: string;
  readonly id: string;
}

type Settles<Given> = (
  run: RunStreamAddress,
  settlement: Given,
  lineage?: Lineage,
) => Effect.Effect<SettledRun, NotFound | Conflict | Unavailable>;

export type SettleRun = Settles<SettlementOfAnOperation>;

export type SettleRunWithItsPayload = Settles<Settlement>;

type SettleAsRead = (
  run: RunStreamAddress,
  settlement: Settlement,
  readAt: number,
  lineage?: Lineage,
) => Effect.Effect<SettledRun, NotFound | Conflict | Unavailable>;

const isWellFormed = Schema.is(
  Schema.Struct({ org: OrgIdSchema, playbook: PlaybookIdSchema, id: Schema.String.check(Schema.isUUID()) }),
);

const decodeOutput = Schema.decodeUnknownEffect(Schema.Json);

const decodeRecord = Schema.decodeUnknownEffect(Schema.JsonObject);

const failure: RunResult = { type: 'run_failed', data: {} };

function rejectionOf(settlement: SettledRejection): RunRejection {
  if (settlement.reason === 'invalid_input') {
    return {
      reason: settlement.reason,
      detail: settlement.detail,
      issues: settlement.issues ?? [],
      ...causeOf(settlement),
    };
  }
  if (settlement.reason === 'unavailable') {
    const { reason, detail, kind, because } = settlement;
    return {
      reason,
      detail,
      ...(kind === undefined ? {} : { kind }),
      ...(because === undefined ? {} : { because }),
      ...causeOf(settlement),
    };
  }
  if (settlement.reason === 'conflict') {
    const { reason, detail, kind, because } = settlement;
    return {
      reason,
      detail,
      ...(kind === undefined ? {} : { kind }),
      ...(because === undefined ? {} : { because }),
      ...causeOf(settlement),
    };
  }
  if (settlement.reason === 'unanswered') {
    const { reason, detail, kind } = settlement;
    return { reason, detail, kind, ...causeOf(settlement) };
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

interface SettlingTarget {
  readonly run: RunStreamAddress;
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

function outputChecked(output: Payload<Schema.Json>): Effect.Effect<Payload<Schema.Json>> {
  return 'inline' in output
    ? Effect.map(Effect.orDie(decodeOutput(output.inline)), (inline) => ({ inline }))
    : Effect.succeed(output);
}

function succeededWith(output: Payload<Schema.Json>, given: Schema.JsonObject): Effect.Effect<RunResult> {
  return Effect.gen(function* () {
    const checked = yield* outputChecked(output);
    const record = yield* Effect.orDie(decodeRecord(given));
    yield* withinResultBytes(payloadBytesOf(checked) + jsonBytesOf(record));
    return { type: 'run_succeeded', data: { ...payloadMembers('output', checked), record } };
  });
}

function resultOf(settlement: Settlement, written: WrittenOutput): Effect.Effect<Resulted> {
  if (settlement.status === 'succeeded') {
    return Effect.suspend(() =>
      Effect.flatMap(written(outputPayloadOf({ data: settlement })), ({ payload, inHand }) =>
        Effect.map(succeededWith(payload, settlement.record ?? {}), (result) => ({ result, inHand })),
      ),
    );
  }
  if (settlement.status === 'rejected') {
    return Effect.map(rejectedWith(settlement), resultedAlone);
  }
  const { incident } = settlement;
  return Effect.succeed(resultedAlone(incident === undefined ? failure : { type: 'run_failed', data: { incident } }));
}

function settlerOver(
  settledOn: SettledOn,
  streamNamed: (address: RunStreamAddress) => Effect.Effect<string, NotFound>,
  outputs: SettledOutputs = outputsAsGiven,
): SettleRunWithItsPayload {
  const settle = Effect.fnUntraced(function* (
    target: SettlingTarget,
    offered: Resulted,
    by: string,
    lineage?: Lineage,
  ) {
    const at = DateTime.formatIso(yield* DateTime.now);
    const { run, stream, runId } = target;
    const { result } = offered;
    const settled = (valuesRead: Resulted['inHand']) =>
      settledOn(
        stream,
        { type: 'settle', result, runId, by, at, ...(valuesRead.size === 0 ? {} : { valuesRead }) },
        lineage,
      );
    return yield* settledComparing(outputs, { run, stream, offered }, settled).pipe(
      Effect.catchTag('cancelled', Effect.die),
    );
  });
  return (run, settlement, lineage) =>
    Effect.gen(function* () {
      const target = { run, stream: yield* streamNamed(run), runId: run.id.toLowerCase() };
      const by = settlement.by ?? playbookCallerOf(run).id;
      const offered = yield* resultOf(settlement, outputs.written(run)).pipe(
        Effect.tapDefect(() => Effect.ignore(settle(target, resultedAlone(failure), by, lineage))),
      );
      const { state } = yield* settle(target, offered, by, lineage);
      return Struct.omit(yield* runOf(target.runId, state), ['output']);
    });
}

export function runSettler(ledger: StreamWriter): SettleRunWithItsPayload {
  return settlerOver(settledOnLatest(ledger), streamOf);
}

export function runSettlerKeepingOutputs(ledger: StreamWriter & StreamReader & ContentKeeper): SettleRunWithItsPayload {
  return settlerOver(settledOnLatest(ledger), streamOf, outputsKeptIn(ledger));
}

export function runSettlerAsRead(ledger: StreamWriter): SettleAsRead {
  return (run, settlement, readAt, lineage) =>
    settlerOver(settledOnRead(ledger, readAt), streamOf)(run, settlement, lineage);
}

export function playbookBoundSettler(writer: StreamWriter): SettleRunWithItsPayload {
  return settlerOver(settledOnLatest(writer), playbookStreamOf);
}
