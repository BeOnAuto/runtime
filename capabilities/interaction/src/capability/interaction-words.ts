import { Buffer } from 'node:buffer';

import { defaultRunWords, outputInWords, type RunAccount, type RunWords } from '@on.auto/definitions';
import type { Schema } from 'effect';

import { callOutputInWords } from '../call/call-words.ts';
import { isNotification, requestRecordOf, takesAnswer } from '../run/request-record.ts';
import { interactionBounds } from '../run/run-bounds.ts';
import { routeOf, throughWords } from '../tool-blocks/routes.ts';

function cutParty(party: string): string {
  const bytes = Buffer.from(party, 'utf8');
  return bytes.length <= interactionBounds.toBytes
    ? party
    : new TextDecoder().decode(bytes.subarray(0, interactionBounds.toBytes));
}

function requestAccount(record: Schema.JsonObject): RunAccount | undefined {
  const request = requestRecordOf(record);
  if (request === undefined) {
    return undefined;
  }
  const answers = takesAnswer(request);
  const route = routeOf(request);
  const what = answers ? 'A request is waiting for an answer' : 'A notification is waiting to be delivered';
  const answerer = request.answerer === request.to ? undefined : request.answerer;
  const from = answerer === undefined ? '' : '; a reply counts from its answerer alone';
  return {
    summary: `${what}, ${throughWords(route)}, until ${request.expires_at}${from}.`,
    data: {
      delivery: route.kind === 'inbox' ? null : { server: route.delivery.server, tool: route.delivery.tool },
      to: cutParty(request.to),
      ...(answerer === undefined ? {} : { answerer: cutParty(answerer) }),
      message_bytes: Buffer.byteLength(request.message, 'utf8'),
      takes_answer: answers,
      expires_at: request.expires_at,
    },
  };
}

export const interactionRunWords: RunWords = {
  ...defaultRunWords,
  deferralType: 'interaction_requested',
  deferral: requestAccount,
};

const answerInWords = outputInWords('answer');

export function describeAnswer(output: Schema.Json, record?: Schema.JsonObject): string {
  const asked = callOutputInWords(output, record);
  if (asked !== undefined) {
    return asked;
  }
  return isNotification(record) ? 'It delivered its notification.' : answerInWords(output);
}
