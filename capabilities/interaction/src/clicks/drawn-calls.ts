import { recordedRunIn } from '@on.auto/definitions';
import { renderClock } from '@on.auto/definitions/template';
import { renderedArguments } from '@on.auto/definitions/tool-blocks';
import { Effect, Option, Result, Schema } from 'effect';

import { DeliverySchema, type OpenRequestRow } from '../requests/request-rows.ts';
import { requestRecordOf } from '../run/request-record.ts';
import type { DeliveryParts } from '../schedule/delivery-parts.ts';
import type { TellingCall } from '../tellings/telling-calls.ts';
import { TellingRouteSchema } from '../tellings/telling-routes.ts';
import { drawnMessage, overHowOf } from './drawn-messages.ts';

const decodeRoute = Schema.decodeUnknownOption(Schema.fromJsonString(TellingRouteSchema));

const decodeSent = Schema.decodeUnknownSync(
  Schema.Struct({ sent_conversation: Schema.String, sent_id: Schema.String }),
);

const decodeDelivered = Schema.decodeUnknownSync(Schema.fromJsonString(DeliverySchema));

export interface RunAddress {
  readonly org: string;
  readonly playbook: string;
  readonly id: string;
}

type Update = NonNullable<Schema.Schema.Type<typeof TellingRouteSchema>['update']>;

function callOf(update: Update, input?: Readonly<Record<string, Schema.Json>>): TellingCall | undefined {
  return input === undefined
    ? undefined
    : {
        about: 'drawn',
        form: 'update',
        tool: update.tool,
        input,
        idAt: update.sent,
        conversationAt: undefined,
      };
}

export function drawnCallOf(
  parts: DeliveryParts,
  address: RunAddress,
  row: OpenRequestRow,
  over: boolean,
): Effect.Effect<TellingCall | undefined> {
  const update = Option.getOrUndefined(decodeRoute(row.tell))?.update;
  if (update === undefined) {
    return Effect.undefined;
  }
  const { sent_conversation: conversation, sent_id: id } = decodeSent(row);
  const server = decodeDelivered(row.delivery).server;
  return Effect.gen(function* () {
    const run = yield* recordedRunIn(parts.ledger, address);
    const redraw = requestRecordOf(run?.run.record)?.redraw;
    if (run === undefined || redraw === undefined) {
      return callOf(update);
    }
    const message = Result.getOrUndefined(drawnMessage(redraw, run.work, over ? overHowOf(row.ending) : undefined));
    const clock = yield* renderClock;
    const rendered =
      message === undefined
        ? undefined
        : Result.getOrUndefined(
            renderedArguments(
              update.with,
              { sent: { conversation, id }, message: message.text, rendered: message.payload },
              clock,
              parts.tools.mostRequestBytesTo(server),
            ),
          );
    return callOf(update, rendered?.input);
  });
}
