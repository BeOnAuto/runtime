import { admission, admittedAsSent, countedAsSent, type CallCount, type CallTally } from '@on.auto/tool-servers/policy';
import { Schema } from 'effect';

import {
  askedIn,
  libraryResults,
  noAsking,
  noLongerOffered,
  notAnObject,
  resultPart,
  type AdmittedCall,
  type AskedCall,
  type Asking,
  type Offer,
} from './asked-calls.ts';
import type { FactData } from './attempt-facts.ts';

const isArguments = Schema.is(Schema.Record(Schema.String, Schema.Unknown));

export interface Admitted {
  readonly asking: Asking;
  readonly tally: CallTally;
}

type StepOffer = Omit<Offer, 'final'>;

function refusedIn({ asking, tally }: Admitted, call: AskedCall, text: string): Admitted {
  return {
    asking: {
      ...asking,
      refused: new Map([...asking.refused, [call.callId, text]]),
      results: new Map([...asking.results, [call.callId, resultPart(call, { text, isError: true })]]),
    },
    tally,
  };
}

function admittedIn({ asking }: Admitted, call: AdmittedCall, tally: CallTally): Admitted {
  return { asking: { ...asking, admitted: [...asking.admitted, call] }, tally };
}

function askedNow(admitted: Admitted, call: Omit<AdmittedCall, 'reads'>, count: CallCount): Admitted {
  const { callId, tool, input, offer } = call;
  const admitting = admission(admitted.tally, { tool, callId, input, reads: offer.readOnly }, count);
  return admitting.admitted
    ? admittedIn(admitted, { ...call, reads: offer.readOnly }, admitting.tally)
    : refusedIn({ ...admitted, tally: admitting.tally }, call, admitting.refusal);
}

function sentBefore(admitted: Admitted, call: Omit<AdmittedCall, 'reads'>, reads: boolean, count: CallCount): Admitted {
  const { callId, tool, input } = call;
  return admittedIn(
    admitted,
    { ...call, reads },
    admittedAsSent(admitted.tally, { tool, callId, input, reads }, count),
  );
}

function noLongerOfferedOnceSent(admitted: Admitted, call: AskedCall, reads: boolean, count: CallCount): Admitted {
  const counted = { ...admitted, tally: countedAsSent(admitted.tally, { reads }, count) };
  return admitted.asking.results.has(call.callId) ? counted : refusedIn(counted, call, noLongerOffered(call.tool));
}

function admittedOne(admitted: Admitted, call: AskedCall, { offered, count }: StepOffer, sent: boolean): Admitted {
  if (!sent && admitted.asking.results.has(call.callId)) {
    return admitted;
  }
  const reads = admitted.asking.started.get(call.callId) === true;
  const offer = offered.get(call.tool);
  if (offer === undefined) {
    return sent
      ? noLongerOfferedOnceSent(admitted, call, reads, count)
      : refusedIn(admitted, call, noLongerOffered(call.tool));
  }
  if (!isArguments(call.input)) {
    return refusedIn(admitted, call, notAnObject);
  }
  const asked = { ...call, input: call.input, offer };
  return sent ? sentBefore(admitted, asked, reads, count) : askedNow(admitted, asked, count);
}

function alreadySent({ started, results }: Asking, { offered }: StepOffer, { callId, tool }: AskedCall): boolean {
  const onlyRead = started.get(callId);
  return onlyRead !== undefined && !(onlyRead && !results.has(callId) && offered.has(tool));
}

function admittedOver(asking: Asking, offer: StepOffer): Admitted {
  const sent = asking.asked.filter((call) => alreadySent(asking, offer, call));
  const toSend = asking.asked.filter((call) => !alreadySent(asking, offer, call));
  const counted = sent.reduce<Admitted>((admitted, call) => admittedOne(admitted, call, offer, true), {
    asking,
    tally: asking.before,
  });
  return toSend.reduce<Admitted>((admitted, call) => admittedOne(admitted, call, offer, false), counted);
}

export function admittedFrom(
  response: readonly Schema.JsonObject[],
  tally: CallTally,
  { final, ...offer }: Offer,
): Admitted {
  return admittedOver(
    { ...noAsking, asked: askedIn(response), before: tally, results: libraryResults(response), final },
    offer,
  );
}

export function countedAsItsFact(
  { admitted }: Asking,
  { call_id: callId, read_only: readOnly }: FactData<'tool_call_started'>,
): boolean {
  return admitted.some((call) => call.callId === callId && call.reads === (readOnly === true));
}

export function admittedAgain(asking: Asking, offer: StepOffer): Admitted {
  const results = new Map(
    [...asking.results].filter(([callId]: readonly [string, Schema.JsonObject]) => !asking.refused.has(callId)),
  );
  return admittedOver({ ...asking, admitted: [], refused: new Map(), results, outdated: false }, offer);
}
