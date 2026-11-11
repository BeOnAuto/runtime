import type { RecordedRunFact } from '@on.auto/definitions';
import { factReaderOf, type ProjectedMessage } from '@on.auto/operations';
import { ConversationCallEventSchema } from '@on.auto/tool-servers';
import { Schema } from 'effect';

import { answeredInAuto, endingColumnsOf, toldTheEnding, type Ended, type EndingColumns } from './ending-rows.ts';
import { UnansweredKindSchema } from './ending-words.ts';
import { takenColumnsOf, toldAllOfTheTaken, type TakenColumns } from './taken-rows.ts';
import type { StartedTelling } from './telling-calls.ts';

const tellingCall = factReaderOf(ConversationCallEventSchema);

const isUnanswered = Schema.is(UnansweredKindSchema);

function startedTelling(message: ProjectedMessage) {
  const fact = tellingCall(message);
  return fact?.type === 'telling_started' ? fact : undefined;
}

export function runOfATelling(message: ProjectedMessage): string | undefined {
  return startedTelling(message)?.context.runId;
}

export function tellingStartedOf(message: ProjectedMessage): StartedTelling | undefined {
  return startedTelling(message)?.data;
}

export interface Told extends Ended {
  readonly ending: string | null;
}

export function toldOfTheAnswer(
  row: Told,
  fact: RecordedRunFact<'request_answered'>,
  id: string,
): TakenColumns | EndingColumns | undefined {
  const { reply } = fact.data;
  return reply === undefined ? answeredInAuto(row, fact, id) : takenColumnsOf(row, fact, reply, id);
}

export function toldOfTheEnd(row: Told, ended: string, id: string, at: string): EndingColumns | undefined {
  return isUnanswered(ended) ? endingColumnsOf(row, { fact: id, kind: ended }, at) : undefined;
}

export function toldAllThatWasDue(row: Told, telling: StartedTelling): boolean {
  return row.ending === null ? toldAllOfTheTaken(row, telling) : toldTheEnding(telling);
}
