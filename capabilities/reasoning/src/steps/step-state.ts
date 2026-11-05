import type { AskedApproval, CallsEndedBecause } from '@on.auto/tool-servers';
import { noCalls, type CallTally, type ToolReply } from '@on.auto/tool-servers/policy';
import type { Schema } from 'effect';

import {
  answerTaken,
  approvalAfterTheCall,
  type Approving,
  type PendingApproval,
  type Waiting,
} from '../approvals/pending-approvals.ts';
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
  readonly asked?: AskedApproval;
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
  readonly waiting: Waiting;
  readonly approval: PendingApproval | null;
}

export interface FirstState {
  readonly offered: Offer['offered'];
  readonly modelCallsBefore: number;
  readonly waiting: Waiting;
}

export function firstState(prompt: Prompt, { offered, modelCallsBefore, waiting }: FirstState): StepState {
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
    waiting,
    approval: null,
  };
}

function approvingOf({ asking, approval, waiting }: StepState): Approving {
  return { open: asking.open, approval, waiting };
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
  if (state.remaking) {
    return { ...state, remaking: false };
  }
  const opened = { ...state, approval: null };
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
  { reply, asked }: Pick<StepContent, 'reply' | 'asked'>,
): StepState {
  const answered = { ...state, answeredBytes: state.answeredBytes + data.result_bytes };
  if (reply === undefined) {
    const approval = approvalAfterTheCall(approvingOf(state), data.number);
    return { ...answered, approval, asking: unreadIn(state.asking, data.number) };
  }
  const taken = answerTaken(approvingOf(state), data.number, reply, asked);
  return endedIn({ ...answered, approval: taken.approval }, answeredIn(state.asking, data.number, taken.reply));
}

function toolCallFailed(state: StepState, data: FactData<'tool_call_failed'>, reply: ToolReply | undefined): StepState {
  if (data.because === 'interrupted') {
    return { ...state, asking: interruptedIn(state.asking, data.number) };
  }
  const counted = {
    ...state,
    ...failureCounted(state.tally, state.serversEnded, data),
    approval: approvalAfterTheCall(approvingOf(state), data.number),
  };
  return endedIn(counted, failedIn(state.asking, data, reply));
}

function toolFact(state: StepState, fact: ToolFact, content: Pick<StepContent, 'reply' | 'asked'>): StepState {
  if (fact.type === 'tool_call_started') {
    return { ...state, asking: startedIn(state.asking, fact.data) };
  }
  return fact.type === 'tool_call_answered'
    ? toolCallAnswered(state, fact.data, content)
    : toolCallFailed(state, fact.data, content.reply);
}

export function providerIn({ facts }: StepState, model: string): string {
  return providerOfTheFacts(facts, model);
}

export function evolve(before: StepState, fact: StepFact, content: StepContent): StepState {
  const state = { ...before, facts: factsAfter(before.facts, fact) };
  if (fact.type === 'model_call_started') {
    return modelCallStarted(state, fact.data, content.sent);
  }
  if (fact.type === 'model_call_answered') {
    return modelCallAnswered(state, fact.data, content.response);
  }
  return fact.type === 'model_call_failed' ? modelCallFailed(state, fact.data) : toolFact(state, fact, content);
}
