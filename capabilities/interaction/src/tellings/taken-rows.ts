import type { RecordedRunFact } from '@on.auto/definitions';
import type { TellingForm } from '@on.auto/tool-servers';
import { Function, Option, Schema } from 'effect';

import { ReplyRuleSchema } from '../replies/reply-rule.ts';
import { takenWords, wordsTakenOf } from '../replies/telling-words.ts';
import { marksATakenReply, tellsALine, type StartedTelling } from './telling-calls.ts';
import { TellingRouteSchema, type TellingRoute } from './telling-routes.ts';

const TakenSchema = Schema.Struct({
  fact: Schema.String,
  reply: Schema.Struct({ id: Schema.String, to: Schema.optionalKey(Schema.String) }),
  words: Schema.Array(Schema.String),
});

export type Taken = typeof TakenSchema.Type;

export const takenFrom = Schema.decodeUnknownSync(Schema.fromJsonString(TakenSchema));

export const tellingOfATakenRow = Schema.decodeUnknownSync(Schema.fromJsonString(TellingRouteSchema));

export function takenMessageOf({ words }: Taken): string {
  return takenWords(words);
}

const tellingOfRow = Schema.decodeUnknownOption(Schema.fromJsonString(TellingRouteSchema));

const ruleOfRow = Schema.decodeUnknownOption(Schema.fromJsonString(ReplyRuleSchema));

const answerOf = Schema.decodeUnknownOption(Schema.Struct({ answer: Schema.Record(Schema.String, Schema.Unknown) }));

interface Kept {
  readonly tell: string | null;
  readonly reply: string | null;
}

function tellingKept({ tell }: Kept): TellingRoute | undefined {
  return Option.getOrUndefined(tellingOfRow(tell));
}

function lastTakenFormOf(telling: TellingRoute | undefined): TellingForm | undefined {
  if (telling === undefined) {
    return undefined;
  }
  if (tellsALine(telling, 'taken')) {
    return 'line';
  }
  return marksATakenReply(telling) ? 'mark' : undefined;
}

export interface TakenColumns {
  readonly taken: string | null;
  readonly telling_due_at: number | null;
}

export function wordsAnsweredOf(rule: string | null, data: RecordedRunFact<'request_answered'>['data']) {
  const { answer } = Option.getOrElse(answerOf(data), Function.constant({ answer: {} }));
  return wordsTakenOf(Option.getOrElse(ruleOfRow(rule), Function.constant({})), answer);
}

export function takenColumnsOf(
  kept: Kept,
  { data, context }: RecordedRunFact<'request_answered'>,
  reply: Taken['reply'],
  id: string,
): TakenColumns {
  const taken: Taken = { fact: id, reply, words: wordsAnsweredOf(kept.reply, data) };
  const tells = lastTakenFormOf(tellingKept(kept)) !== undefined;
  return { taken: JSON.stringify(taken), telling_due_at: tells ? Date.parse(context.at) : null };
}

export function toldAllOfTheTaken(kept: Kept, { about, form }: StartedTelling): boolean {
  return about === 'taken' && form === lastTakenFormOf(tellingKept(kept));
}
