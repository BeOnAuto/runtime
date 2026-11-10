import {
  runSettler,
  type KeptContentReader,
  type RecordWork,
  type RecordedWorkAt,
  type Settlement,
  type Work,
  type WorkRule,
} from '@on.auto/definitions';
import type {
  Lineage,
  ProjectionReader,
  RecordedPageRequest,
  RecordedReader,
  StreamReader,
  StreamWriter,
  Unavailable,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { RequestAddress } from '../delivery/attempt-end.ts';
import type { DeliveryEvent } from '../facts/run-facts.ts';
import { deliveryRule } from '../facts/work-rules.ts';
import { answerTakenIn, lastAnswerPage } from '../requests/request-reads.ts';
import type { DueRequest } from './delivery-parts.ts';
import { answeredSettlement, deliveredSettlement } from './request-endings.ts';

export interface RequestLedger
  extends
    StreamWriter,
    StreamReader,
    Pick<RecordedReader, 'readRecorded'>,
    Pick<ProjectionReader, 'readDueRows' | 'nextDueOf'>,
    KeptContentReader {}

function endedBefore(): Effect.Effect<void> {
  return Effect.void;
}

export function settled(
  ledger: StreamWriter,
  address: RequestAddress,
  settlement: Settlement,
  lineage: Lineage,
): Effect.Effect<void> {
  return runSettler(ledger)(address, settlement, lineage).pipe(
    Effect.asVoid,
    Effect.catchTags({ conflict: endedBefore, unavailable: endedBefore, not_found: Effect.die }),
  );
}

export interface RuledWork {
  readonly work: Work;
  readonly rule: WorkRule;
}

function notTaken(): Effect.Effect<undefined> {
  return Effect.undefined;
}

export function recordedWork(
  record: RecordWork,
  address: RequestAddress,
  { work, rule }: RuledWork,
  lineage: Lineage,
): Effect.Effect<RecordedWorkAt | undefined, Unavailable> {
  return record(address, work, lineage, rule).pipe(Effect.catchTag('conflict', notTaken));
}

export function recordedCall(
  record: RecordWork,
  address: RequestAddress,
  fact: DeliveryEvent,
  lineage: Lineage,
): Effect.Effect<RecordedWorkAt | undefined> {
  return recordedWork(record, address, { work: { type: 'work', fact }, rule: deliveryRule(fact) }, lineage).pipe(
    Effect.catchTag('unavailable', Effect.die),
  );
}

const lastDelivered: RecordedPageRequest = { order: 'desc', limit: 1, types: ['delivery_succeeded'], dataOf: [] };

const decodeLast = Schema.decodeUnknownSync(
  Schema.NonEmptyArray(Schema.Struct({ id: Schema.String, context: Schema.Struct({ at: Schema.String }) })),
);

function lastOnTheRun(ledger: RequestLedger, address: RequestAddress, page: RecordedPageRequest) {
  return ledger.readRecorded(address, { kind: 'run', run: address.id }, page).pipe(
    Effect.map(({ records }) => records),
    Effect.orDie,
  );
}

export function settledAnswered(ledger: RequestLedger, { address, lineage }: DueRequest): Effect.Effect<void> {
  return Effect.flatMap(lastOnTheRun(ledger, address, lastAnswerPage), (records) => {
    const taken = answerTakenIn(records);
    return settled(ledger, address, answeredSettlement(taken), { ...lineage, causationId: taken.id });
  });
}

export function settledDelivered(ledger: RequestLedger, { address, lineage }: DueRequest): Effect.Effect<void> {
  return Effect.flatMap(lastOnTheRun(ledger, address, lastDelivered), (records) => {
    const [{ id, context }] = decodeLast(records);
    return settled(ledger, address, deliveredSettlement(context.at), { ...lineage, causationId: id });
  });
}
