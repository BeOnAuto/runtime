import { Buffer } from 'node:buffer';

import {
  defaultRunWords,
  outputInWords,
  type GuideVariables,
  type RunAccount,
  type RunWords,
} from '@on.auto/definitions';
import { callOutputInWords } from '@on.auto/definitions/tool-blocks';
import { changedOnlyByWhoeverRunsTheServer, sizeInWords } from '@on.auto/phrasing';
import { toolBounds, type ToolAccess } from '@on.auto/tool-servers';
import type { Schema } from 'effect';

import type { InteractionPorts } from '../run/request-reach.ts';
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
      delivery: route.kind === 'agent' ? null : { server: route.delivery.server, tool: route.delivery.tool },
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

interface Offered extends Pick<InteractionPorts, 'mostOpenRequests'> {
  readonly tools: Pick<ToolAccess, 'mostRequestBytes'>;
}

const counted = new Intl.NumberFormat('en');

const asThePageHasIt: Offered = {
  tools: { mostRequestBytes: toolBounds.requestBytes },
  mostOpenRequests: interactionBounds.openRequests,
};

function openAtOnce(requests: number): string {
  return `${counted.format(requests)} at once`;
}

export function guideVariablesOf({ tools, mostOpenRequests } = asThePageHasIt): GuideVariables {
  return {
    'interaction.most_call_arguments': {
      value: sizeInWords(tools.mostRequestBytes),
      default: sizeInWords(asThePageHasIt.tools.mostRequestBytes),
    },
    'interaction.most_open_requests': {
      value: openAtOnce(mostOpenRequests),
      default: openAtOnce(asThePageHasIt.mostOpenRequests),
    },
    'interaction.bounds_changed_by': {
      value: changedOnlyByWhoeverRunsTheServer,
      default: changedOnlyByWhoeverRunsTheServer,
    },
  };
}
