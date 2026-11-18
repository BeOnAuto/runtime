import { runCorrelationIn } from '@on.auto/definitions';
import { renderClock } from '@on.auto/definitions/template';
import { Effect, Schema } from 'effect';

import type { RequestAddress } from '../delivery/attempt-end.ts';
import { openRequestsName } from '../requests/open-requests.ts';
import { DeliverySchema, requestRowFrom, type OpenRequestRow } from '../requests/request-rows.ts';
import type { DeliveryParts } from '../schedule/delivery-parts.ts';
import { rowTellingItsWords } from './answer-words.ts';
import { dueCallsOf, type DueCalls } from './due-calls.ts';
import { onceFor, told, type Telling } from './tellings.ts';

const decodeDelivery = Schema.decodeUnknownSync(Schema.fromJsonString(DeliverySchema));

const toldAll = { set: { telling_due_at: null }, when: [] };

export interface FiledRequest extends RequestAddress {
  readonly filedIn: Telling['filedIn'];
}

function playbookOf({ org, playbook }: RequestAddress) {
  return { org, playbook };
}

function callsMade(parts: DeliveryParts, address: FiledRequest, row: OpenRequestRow, room: Effect.Effect<boolean>) {
  return Effect.gen(function* () {
    const correlationId = yield* runCorrelationIn(parts.ledger, address);
    const withItsWords = yield* rowTellingItsWords(parts, address, row);
    const { server } = decodeDelivery(row.delivery);
    const rendering = { clock: yield* renderClock, mostBytes: parts.tools.mostRequestBytesTo(server) };
    const { cause, conversation, calls } = dueCallsOf(withItsWords, rendering);
    const tellingOf = (call: DueCalls['calls'][number]): Telling => ({
      playbook: playbookOf(address),
      filedIn: address.filedIn,
      server,
      runId: address.id,
      definition: { definitionType: 'interaction', definitionName: row.function, definitionVersion: row.version },
      lineage: { causationId: cause, correlationId },
      conversation,
      call,
    });
    for (const call of calls) {
      if (!(yield* room)) {
        return false;
      }
      yield* told(parts, tellingOf(call), onceFor({ runId: address.id, call }));
    }
    return true;
  });
}

function toldOfTheRow(parts: DeliveryParts, address: FiledRequest, row: OpenRequestRow, room: Effect.Effect<boolean>) {
  return Effect.tap(callsMade(parts, address, row, room), (made) =>
    made ? parts.ledger.advanceRow(openRequestsName, address.filedIn, address.id, toldAll) : Effect.void,
  );
}

function rowsDueOf(parts: DeliveryParts, address: FiledRequest, through: number) {
  const query = { where: [{ column: 'row_key', equals: address.id }], orderBy: [], order: 'asc', limit: 1 } as const;
  return Effect.map(parts.ledger.readProjectedRows(openRequestsName, address.filedIn, query), (rows) =>
    rows
      .map(({ row }) => requestRowFrom(row))
      .filter(({ telling_due_at: dueAt }) => dueAt !== null && dueAt <= through),
  );
}

export function toldThrough(
  parts: DeliveryParts,
  address: FiledRequest,
  through: number,
  room: Effect.Effect<boolean>,
) {
  return Effect.flatMap(rowsDueOf(parts, address, through), (rows: readonly OpenRequestRow[]) =>
    Effect.map(
      Effect.forEach(rows, (row) => toldOfTheRow(parts, address, row, room)),
      (made: readonly boolean[]) => !made.includes(false),
    ),
  );
}
