import type { CallsEndedBecause } from '@on.auto/tool-servers';
import { noCalls, type CallTally, type ToolReply } from '@on.auto/tool-servers/policy';
import type { Schema } from 'effect';

import type { ModelMessage } from '../model/model-request.ts';
import { noTurns, toolAnswered, turnAnswered, type Meter } from '../tools/turn-meter.ts';
import {
  admittedFrom,
  answeredIn,
  assistantMessages,
  failedIn,
  failureCounted,
  interruptedIn,
  noAsking,
  startedIn,
  unreadIn,
  type Asking,
  type Ended,
  type Offer,
} from './asked-calls.ts';
import {
  factsAfter,
  noFactsYet,
  providerOfTheFacts,
  type AttemptFacts,
  type FactData,
  type StepFact,
} from './attempt-facts.ts';
import type { Prompt, StepMessages } from './step-messages.ts';

type ToolFact = Extract<StepFact, { readonly type: 'tool_call_started' | 'tool_call_answered' | 'tool_call_failed' }>;

export interface StepContent {
  readonly sent?: StepMessages;
  readonly response?: readonly Schema.JsonObject[];
  readonly reply?: ToolReply;
}

export type StepEnding =
  | {
      readonly type: 'answered';
      readonly data: FactData<'model_call_answered'>;
      readonly response: readonly Schema.JsonObject[];
    }
  | { readonly type: 'failed'; readonly data: FactData<'model_call_failed'> };

export interface StepState {
  readonly offered: Offer['offered'];
  readonly prompt: Prompt;
  readonly conversation: readonly Schema.JsonObject[];
  readonly retold: readonly ModelMessage[] | null;
  readonly facts: AttemptFacts;
  readonly lastSent: StepMessages;
  readonly lastFinal: boolean;
  readonly remaking: boolean;
  readonly asking: Asking;
  readonly meter: Meter;
  readonly tally: CallTally;
  readonly serversEnded: CallsEndedBecause | null;
  readonly answeredBytes: number;
  readonly ending: StepEnding | null;
  readonly unreadable: boolean;
}

export function firstState(prompt: Prompt, offered: Offer['offered'], modelCallsBefore: number): StepState {
  return {
    offered,
    prompt,
    conversation: [],
    retold: null,
    facts: noFactsYet(modelCallsBefore),
    lastSent: prompt,
    lastFinal: false,
    remaking: false,
    asking: noAsking,
    meter: noTurns,
    tally: noCalls,
    serversEnded: null,
    answeredBytes: 0,
    ending: null,
    unreadable: false,
  };
}

function sentIn(state: StepState, sent: StepMessages): StepState {
  if (sent.kind === 'prompt') {
    return { ...state, prompt: sent };
  }
  return sent.kind === 'results'
    ? { ...state, conversation: [...state.conversation, ...sent.messages], asking: noAsking }
    : { ...state, retold: sent.messages, asking: noAsking };
}

function modelCallStarted(
  state: StepState,
  { tools_offered: offered }: FactData<'model_call_started'>,
  sent: StepMessages | undefined,
): StepState {
  const opened = { ...state, remaking: false };
  if (state.remaking) {
    return opened;
  }
  const final = state.offered.size > 0 && offered === 0;
  return sent === undefined
    ? { ...opened, lastFinal: final, unreadable: true }
    : sentIn({ ...opened, lastSent: sent, lastFinal: final }, sent);
}

function modelCallAnswered(
  state: StepState,
  data: FactData<'model_call_answered'>,
  response: readonly Schema.JsonObject[] | undefined,
): StepState {
  const { usage } = data;
  const meter = turnAnswered(state.meter, {
    sentBytes: data.request_bytes,
    inputTokens: usage.input.total,
    outputTokens: usage.output.total,
    calls: data.tool_calls.length,
  });
  const answered = { ...state, meter };
  if (response === undefined) {
    return { ...answered, unreadable: true };
  }
  if (data.tool_calls.length === 0) {
    return { ...answered, ending: { type: 'answered', data, response } };
  }
  const admitted = admittedFrom(response, state.tally, {
    final: state.lastFinal || state.offered.size === 0,
    offered: state.offered,
  });
  const meterOfRefusals = admitted.refusals.reduce((now, text) => toolAnswered(now, text), meter);
  return {
    ...answered,
    meter: meterOfRefusals,
    conversation: [...state.conversation, ...assistantMessages(response)],
    asking: admitted.asking,
    tally: admitted.tally,
  };
}

function modelCallFailed(state: StepState, data: FactData<'model_call_failed'>): StepState {
  return data.because === 'interrupted' ? { ...state, remaking: true } : { ...state, ending: { type: 'failed', data } };
}

function endedIn(state: StepState, { asking, replies }: Ended): StepState {
  return { ...state, asking, meter: replies.reduce((meter, { text }) => toolAnswered(meter, text), state.meter) };
}

function toolCallAnswered(
  state: StepState,
  data: FactData<'tool_call_answered'>,
  reply: ToolReply | undefined,
): StepState {
  const answered = { ...state, answeredBytes: state.answeredBytes + data.result_bytes };
  return reply === undefined
    ? { ...answered, asking: unreadIn(state.asking, data.number) }
    : endedIn(answered, answeredIn(state.asking, data.number, reply));
}

function toolCallFailed(state: StepState, data: FactData<'tool_call_failed'>, reply: ToolReply | undefined): StepState {
  if (data.because === 'interrupted') {
    return { ...state, asking: interruptedIn(state.asking, data.number) };
  }
  const counted = { ...state, ...failureCounted(state.tally, state.serversEnded, data) };
  return endedIn(counted, failedIn(state.asking, data, reply));
}

function toolFact(state: StepState, fact: ToolFact, reply: ToolReply | undefined): StepState {
  if (fact.type === 'tool_call_started') {
    return { ...state, asking: startedIn(state.asking, fact.data) };
  }
  return fact.type === 'tool_call_answered'
    ? toolCallAnswered(state, fact.data, reply)
    : toolCallFailed(state, fact.data, reply);
}

export function providerIn({ facts }: StepState, model: string): string {
  return providerOfTheFacts(facts, model);
}

export function evolve(before: StepState, fact: StepFact, { sent, response, reply }: StepContent): StepState {
  const state = { ...before, facts: factsAfter(before.facts, fact) };
  if (fact.type === 'model_call_started') {
    return modelCallStarted(state, fact.data, sent);
  }
  if (fact.type === 'model_call_answered') {
    return modelCallAnswered(state, fact.data, response);
  }
  return fact.type === 'model_call_failed' ? modelCallFailed(state, fact.data) : toolFact(state, fact, reply);
}
