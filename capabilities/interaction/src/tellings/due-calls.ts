import type { RenderClock } from '@on.auto/definitions/template';
import { Schema } from 'effect';

import type { OpenRequestRow } from '../requests/request-rows.ts';
import { endingFrom } from './ending-rows.ts';
import { endingWords, isPlacedByTheRequest, namingTheRequest } from './ending-words.ts';
import { takenFrom, takenMessageOf, tellingOfATakenRow } from './taken-rows.ts';
import { lineCallOf, markCallOf, type TellingCall, type Told } from './telling-calls.ts';
import type { TellingRoute } from './telling-routes.ts';

export interface DueCalls {
  readonly cause: string;
  readonly conversation: string;
  readonly calls: readonly TellingCall[];
}

interface Place {
  readonly toldTo: Told;
  readonly sentAt: number;
  readonly clock: RenderClock;
}

const decodeSent = Schema.decodeUnknownSync(
  Schema.Struct({ sent_conversation: Schema.String, sent_id: Schema.String, sent_at: Schema.Int }),
);

function made({ toldTo }: Place, cause: string, calls: readonly (TellingCall | undefined)[]): DueCalls {
  return { cause, conversation: toldTo.sent.conversation, calls: calls.filter((call) => call !== undefined) };
}

function takenCalls(telling: TellingRoute, place: Place, taken: unknown): DueCalls {
  const { fact, reply, words } = takenFrom(taken);
  const said = { ...place.toldTo, reply, message: takenMessageOf({ fact, reply, words }) };
  return made(place, fact, [markCallOf(telling, said, place.clock), lineCallOf(telling, 'taken', said, place.clock)]);
}

function endingCalls(telling: TellingRoute, place: Place, ending: string): DueCalls {
  const ended = endingFrom(ending);
  const words = endingWords(ended);
  const message = isPlacedByTheRequest(telling) ? words : namingTheRequest(place.sentAt, words);
  return made(place, ended.fact, [lineCallOf(telling, 'ended', { ...place.toldTo, message }, place.clock)]);
}

export function dueCallsOf(row: OpenRequestRow, clock: RenderClock): DueCalls {
  const { sent_conversation: conversation, sent_id: id, sent_at: sentAt } = decodeSent(row);
  const telling = tellingOfATakenRow(row.tell);
  const place = { toldTo: { to: row.party, sent: { conversation, id } }, sentAt, clock };
  return row.ending === null ? takenCalls(telling, place, row.taken) : endingCalls(telling, place, row.ending);
}
