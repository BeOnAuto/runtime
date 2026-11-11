import { payloadAsRead } from '@on.auto/definitions';
import { Unavailable } from '@on.auto/operations';
import { PayloadsShared, payloadReaderOf } from '@on.auto/operations/payloads';
import { Effect } from 'effect';

import type { RequestAddress } from '../delivery/attempt-end.ts';
import { answerTakenIn, lastAnswerPage } from '../requests/request-reads.ts';
import type { OpenRequestRow } from '../requests/request-rows.ts';
import type { DeliveryParts } from '../schedule/delivery-parts.ts';
import { endingFrom } from './ending-rows.ts';
import { ruleTakesWords, takenFrom, tellsTheTakenInALine, wordsOfTheAnswer } from './taken-rows.ts';

const answerNotReadNow = new Unavailable({
  detail:
    "The answer of the request, which its playbook keeps outside the run's record, could not be read just now to tell its words; the telling waits for it",
  kind: 'content_unavailable',
});

function wordsOfTheAnswerTaken(
  parts: DeliveryParts,
  address: RequestAddress,
  rule: string | null,
): Effect.Effect<readonly string[], Unavailable> {
  return Effect.gen(function* () {
    const { org, playbook, id } = address;
    const { records } = yield* Effect.orDie(
      parts.ledger.readRecorded(address, { kind: 'run', run: id }, lastAnswerPage),
    );
    const { answer } = answerTakenIn(records);
    const payloads = payloadReaderOf({
      owner: { org, playbook },
      content: parts.ledger.content,
      ...(yield* PayloadsShared),
    });
    const read = yield* payloadAsRead(answer, payloads);
    if ('read' in read) {
      return wordsOfTheAnswer(rule, read.read);
    }
    return read.unread === 'unavailable' ? yield* answerNotReadNow : [];
  });
}

function wordsToTell(
  parts: DeliveryParts,
  address: RequestAddress,
  row: OpenRequestRow,
  words: readonly string[],
): Effect.Effect<readonly string[], Unavailable> {
  return words.length > 0 || !ruleTakesWords(row.reply)
    ? Effect.succeed(words)
    : wordsOfTheAnswerTaken(parts, address, row.reply);
}

export function rowTellingItsWords(
  parts: DeliveryParts,
  address: RequestAddress,
  row: OpenRequestRow,
): Effect.Effect<OpenRequestRow, Unavailable> {
  if (row.ending !== null) {
    const ending = endingFrom(row.ending);
    return ending.kind === 'answered'
      ? Effect.map(wordsToTell(parts, address, row, ending.words), (words) => ({
          ...row,
          ending: JSON.stringify({ ...ending, words }),
        }))
      : Effect.succeed(row);
  }
  const taken = takenFrom(row.taken);
  return tellsTheTakenInALine(row)
    ? Effect.map(wordsToTell(parts, address, row, taken.words), (words) => ({
        ...row,
        taken: JSON.stringify({ ...taken, words }),
      }))
    : Effect.succeed(row);
}
