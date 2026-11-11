import { runCorrelationIn } from '@on.auto/definitions';
import { renderClock } from '@on.auto/definitions/template';
import type { PlaybookProjectedRow } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { openRequestsName } from '../requests/open-requests.ts';
import { DeliverySchema, requestRowFrom, type OpenRequestRow } from '../requests/request-rows.ts';
import type { DeliveryParts } from '../schedule/delivery-parts.ts';
import { takenFrom, takenMessageOf, tellingOfATakenRow } from './taken-rows.ts';
import { lineCallOf, markCallOf, type TellingCall, type Told } from './telling-calls.ts';
import { onceFor, told, type Telling } from './tellings.ts';

const decodeDelivery = Schema.decodeUnknownSync(Schema.fromJsonString(DeliverySchema));

export interface TakenTelling {
  readonly key: string;
  readonly callsOut: true;
  readonly perform: (now: number) => Effect.Effect<void>;
}

const decodeSent = Schema.decodeUnknownSync(
  Schema.Struct({ sent_conversation: Schema.String, sent_id: Schema.String }),
);

function sentOf(row: OpenRequestRow) {
  const { sent_conversation: conversation, sent_id: id } = decodeSent(row);
  return { conversation, id };
}

function callsOf(row: OpenRequestRow, toldTo: Told) {
  const telling = tellingOfATakenRow(row.tell);
  const said = { ...toldTo, message: takenMessageOf(takenFrom(row.taken)) };
  return Effect.map(renderClock, (clock) =>
    [markCallOf(telling, toldTo, clock), lineCallOf(telling, 'taken', said, clock)].filter(
      (call) => call !== undefined,
    ),
  );
}

function tellingsOf(parts: DeliveryParts, kept: PlaybookProjectedRow, row: OpenRequestRow) {
  const playbook = { org: kept.org, playbook: kept.playbook };
  const taken = takenFrom(row.taken);
  return Effect.gen(function* () {
    const sent = sentOf(row);
    const correlationId = yield* runCorrelationIn(parts.ledger, { ...playbook, id: kept.key });
    const calls = yield* callsOf(row, { to: row.party, sent, reply: taken.reply });
    const tellingOf = (call: TellingCall): Telling => ({
      playbook,
      server: decodeDelivery(row.delivery).server,
      runId: kept.key,
      definition: { definitionType: 'interaction', definitionName: row.function, definitionVersion: row.version },
      lineage: { causationId: taken.fact, correlationId },
      conversation: sent.conversation,
      call,
    });
    yield* Effect.forEach(calls, (call) => told(parts, tellingOf(call), onceFor({ runId: kept.key, call })), {
      discard: true,
    });
  });
}

export function takenTellingOf(parts: DeliveryParts, kept: PlaybookProjectedRow): TakenTelling {
  const row = requestRowFrom(kept.row);
  const playbook = { org: kept.org, playbook: kept.playbook };
  const done = { set: { telling_due_at: null }, when: [] };
  return {
    key: `${kept.org}/${kept.playbook}/${kept.key}/telling`,
    callsOut: true,
    perform: () =>
      Effect.andThen(
        Effect.suspend(() => tellingsOf(parts, kept, row)),
        parts.ledger.advanceRow(openRequestsName, playbook, kept.key, done),
      ),
  };
}
