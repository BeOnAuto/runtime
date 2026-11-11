import type { RecordedRunFact } from '@on.auto/definitions';
import { Option, Schema } from 'effect';

import { EndingSchema, type Ending } from './ending-words.ts';
import { wordsAnsweredOf } from './taken-rows.ts';
import { tellsALine, type StartedTelling } from './telling-calls.ts';
import { TellingRouteSchema } from './telling-routes.ts';

export const endingFrom = Schema.decodeUnknownSync(Schema.fromJsonString(EndingSchema));

const tellingOfRow = Schema.decodeUnknownOption(Schema.fromJsonString(TellingRouteSchema));

export interface Ended {
  readonly tell: string | null;
  readonly reply: string | null;
  readonly sent_id: string | null;
}

export interface EndingColumns {
  readonly ending: string;
  readonly telling_due_at: number;
}

function tellsTheEnding(row: Ended): boolean {
  const telling = Option.getOrUndefined(tellingOfRow(row.tell));
  return row.sent_id !== null && telling !== undefined && tellsALine(telling, 'ended');
}

export function endingColumnsOf(row: Ended, ending: Ending, at: string): EndingColumns | undefined {
  return tellsTheEnding(row) ? { ending: JSON.stringify(ending), telling_due_at: Date.parse(at) } : undefined;
}

export function answeredInAuto(
  row: Ended,
  { data, context }: RecordedRunFact<'request_answered'>,
  fact: string,
): EndingColumns | undefined {
  const words = wordsAnsweredOf(row.reply, data);
  return endingColumnsOf(row, { fact, kind: 'answered', by: data.answered_by.name, words }, context.at);
}

export function toldTheEnding({ about }: StartedTelling): boolean {
  return about === 'ended';
}
