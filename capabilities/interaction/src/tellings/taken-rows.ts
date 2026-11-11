import type { RecordedRunFact } from '@on.auto/definitions';
import { factReaderOf, type ProjectedMessage } from '@on.auto/operations';
import { ConversationCallEventSchema, type TellingForm } from '@on.auto/tool-servers';
import { Function, Option, Schema } from 'effect';

import { ReplyRuleSchema } from '../replies/reply-rule.ts';
import { takenWords, wordsTakenOf } from '../replies/telling-words.ts';
import { marksATakenReply, tellsALine } from './telling-calls.ts';
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

interface TakenColumns {
  readonly taken: string | null;
  readonly telling_due_at: number | null;
}

export function takenColumnsOf(
  kept: Kept,
  { data, context }: RecordedRunFact<'request_answered'>,
  id: string,
): TakenColumns {
  const { reply } = data;
  if (reply === undefined) {
    return { taken: null, telling_due_at: null };
  }
  const rule = Option.getOrElse(ruleOfRow(kept.reply), Function.constant({}));
  const { answer } = Option.getOrElse(answerOf(data), Function.constant({ answer: {} }));
  const taken: Taken = { fact: id, reply, words: wordsTakenOf(rule, answer) };
  const tells = lastTakenFormOf(tellingKept(kept)) !== undefined;
  return { taken: JSON.stringify(taken), telling_due_at: tells ? Date.parse(context.at) : null };
}

const tellingCall = factReaderOf(ConversationCallEventSchema);

export function runOfATelling(message: ProjectedMessage): string | undefined {
  const fact = tellingCall(message);
  return fact?.type === 'telling_started' ? fact.context.runId : undefined;
}

export function toldAllOfTheTaken(kept: Kept, message: ProjectedMessage): boolean {
  const fact = tellingCall(message);
  return (
    fact?.type === 'telling_started' &&
    fact.data.about === 'taken' &&
    fact.data.form === lastTakenFormOf(tellingKept(kept))
  );
}
