import { runCorrelationIn } from '@on.auto/definitions';
import { renderClock } from '@on.auto/definitions/template';
import type { PlaybookProjectedRow, Unavailable } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { openRequestsName } from '../requests/open-requests.ts';
import { DeliverySchema, requestRowFrom, type OpenRequestRow } from '../requests/request-rows.ts';
import type { DeliveryParts } from '../schedule/delivery-parts.ts';
import { rowTellingItsWords } from './answer-words.ts';
import { dueCallsOf, type DueCalls } from './due-calls.ts';
import { onceFor, told, type Telling } from './tellings.ts';

const decodeDelivery = Schema.decodeUnknownSync(Schema.fromJsonString(DeliverySchema));

export interface DueTelling {
  readonly key: string;
  readonly callsOut: true;
  readonly perform: (now: number) => Effect.Effect<void, Unavailable>;
}

function tellingsOf(parts: DeliveryParts, kept: PlaybookProjectedRow, row: OpenRequestRow) {
  const playbook = { org: kept.org, playbook: kept.playbook };
  return Effect.gen(function* () {
    const correlationId = yield* runCorrelationIn(parts.ledger, { ...playbook, id: kept.key });
    const withItsWords = yield* rowTellingItsWords(parts, { ...playbook, id: kept.key }, row);
    const { cause, conversation, calls } = dueCallsOf(withItsWords, yield* renderClock);
    const tellingOf = (call: DueCalls['calls'][number]): Telling => ({
      playbook,
      server: decodeDelivery(row.delivery).server,
      runId: kept.key,
      definition: { definitionType: 'interaction', definitionName: row.function, definitionVersion: row.version },
      lineage: { causationId: cause, correlationId },
      conversation,
      call,
    });
    yield* Effect.forEach(calls, (call) => told(parts, tellingOf(call), onceFor({ runId: kept.key, call })), {
      discard: true,
    });
  });
}

export function dueTellingOf(parts: DeliveryParts, kept: PlaybookProjectedRow): DueTelling {
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
