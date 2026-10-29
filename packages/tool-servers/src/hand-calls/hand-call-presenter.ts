import { changingEvents, type KeptContent, type PresentedFact, type Presenter } from '@on.auto/operations';
import { Schema } from 'effect';

import { cutAsStored } from '../bounds/text-bytes.ts';
import { callFieldsShown, keptAnswerOf, keptArgumentsOf } from '../calls/shown-calls.ts';
import { answeredInWords, failedInWords, inWords } from '../names/tool-words.ts';
import { HandCallEventSchema, handCallsKind, type RecordedHandCall } from './hand-call-events.ts';

const mostNameBytes = 256;

const decodeHandCallEvent = Schema.decodeUnknownSync(Schema.toCodecJson(HandCallEventSchema));

function presentedFactOf(event: RecordedHandCall, content: KeptContent): PresentedFact {
  if (event.type === 'tool_call_started') {
    const { data } = event;
    const server = cutAsStored(data.server, mostNameBytes);
    const tool = cutAsStored(data.tool, mostNameBytes);
    return {
      type: event.type,
      summary: `Someone allowed to change the playbook called the ${inWords(tool)} tool of ${inWords(server)} by hand.`,
      data: { ...callFieldsShown(data), ...keptArgumentsOf(data, content) },
    };
  }
  if (event.type === 'tool_call_answered') {
    const { data } = event;
    return {
      type: event.type,
      summary: `The tool ${answeredInWords(data.is_error)}.`,
      data: { ...callFieldsShown(data), ...keptAnswerOf(data, content) },
    };
  }
  const { data } = event;
  return { type: event.type, summary: `The tool ${failedInWords[data.because]}.`, data: callFieldsShown(data) };
}

export const handCallPresenter: Presenter = {
  streamKind: handCallsKind,
  publicNames: {
    tool_call_started: ['tool_call_started'],
    tool_call_answered: ['tool_call_answered'],
    tool_call_failed: ['tool_call_failed'],
  },
  present: ({ type, data, context }, content) => [
    presentedFactOf(decodeHandCallEvent({ type, data, context }), content),
  ],
  changes: changingEvents(['tool_call_started', 'tool_call_answered', 'tool_call_failed']),
};
