import type { ModelMessage, ModelRequest, ModelResult, ToolDefinition } from '@on.auto/reasoning';
import { Function } from 'effect';

import type { ChatModel, ConversationMessage, ModelAnswered } from '../model/chat-model.ts';
import type { ToolReply } from '../tools/directory-calls.ts';
import type { Waits } from '../turn/call-bounds.ts';
import type { Turn } from '../turn/turn-state.ts';

export const MODEL = 'provider/model';

export const REFUSED = 'refused_by_the_model';

export type Refused = typeof REFUSED;

export type Answered = ModelAnswered<Refused>;

export interface Answering {
  readonly answered: ModelResult;
}

export type Model = ChatModel<Refused>;

export type Scripted = Answering | { readonly refused: Refused } | (() => Answered);

export type Tools = Turn<Refused>['tools'];

export interface CallAsked {
  readonly id: string;
  readonly tool: string;
  readonly input: unknown;
}

export const LISTING: readonly ToolDefinition[] = [
  { name: 'list_playbooks', description: 'Lists the playbooks', inputSchema: { type: 'object' } },
];

export const MESSAGES: readonly ConversationMessage[] = [
  { role: 'user', text: 'Hello' },
  { role: 'assistant', text: 'Hi, what can I do?' },
  { role: 'user', text: 'List my playbooks' },
];

export const neverSettled = <A>(): Promise<A> => Promise.withResolvers<A>().promise;

export const timeless: Waits = () => ({ elapsed: neverSettled(), stop: Function.constVoid });

export function resultOf(
  text: string,
  assistant: readonly object[] = [],
  response = JSON.stringify(assistant),
): Answering {
  const answered: ModelResult = {
    text,
    finish_reason: 'stop',
    raw_finish_reason: 'stop',
    usage: {
      input: { total: null, uncached: null, cache_read: null, cache_write: null },
      output: { total: null, text: null, reasoning: null },
      total: null,
    },
    model: { requested: MODEL, resolved: MODEL, answered: MODEL },
    response_id: null,
    warnings: [],
    response,
    request_bytes: 0,
    duration_ms: 0,
  };
  return { answered };
}

export const asking = (...calls: readonly CallAsked[]): Answering =>
  resultOf('', [
    {
      role: 'assistant',
      content: calls.map(({ id, tool, input }) => ({ type: 'tool-call', toolCallId: id, toolName: tool, input })),
    },
  ]);

export function usedTokens({ answered }: Answering, input: number, output = 0, requestBytes = 0): Answering {
  return {
    answered: {
      ...answered,
      request_bytes: requestBytes,
      usage: {
        ...answered.usage,
        input: { ...answered.usage.input, total: input },
        output: { ...answered.usage.output, total: output },
      },
    },
  };
}

export const withRequestBytes = ({ answered }: Answering, requestBytes: number): Answering => ({
  answered: { ...answered, request_bytes: requestBytes },
});

export const withUnreportedOutput = ({ answered }: Answering): Answering => ({
  answered: { ...answered, usage: { ...answered.usage, output: { total: null, text: null, reasoning: null } } },
});

export function scripted(...answers: readonly Scripted[]) {
  const requests: ModelRequest[] = [];
  const remaining = [...answers];
  const model: Model = {
    name: MODEL,
    generate: (request) => {
      requests.push(request);
      const next = remaining.shift() ?? resultOf('Nothing more to say');
      return Promise.resolve(typeof next === 'function' ? next() : next);
    },
  };
  return { model, requests };
}

export function toolsThat(reply: (name: string, input: Readonly<Record<string, unknown>>) => ToolReply) {
  const calls: { name: string; input: Readonly<Record<string, unknown>> }[] = [];
  const tools: Tools = {
    call: (name, input) => {
      calls.push({ name, input });
      return Promise.resolve(reply(name, input));
    },
  };
  return { tools, calls };
}

export const listed = (): ToolReply => ({ text: '{"playbooks":[]}', isError: false });

export const turnOver = (model: Model, tools: Tools, offered: readonly ToolDefinition[] = LISTING): Turn<Refused> => ({
  id: 'turn-1',
  instructions: 'You act for Pat',
  messages: MESSAGES,
  model,
  offered,
  tools,
  admitted: () => Promise.resolve(true),
  now: () => 0,
  closed: () => false,
  signal: new AbortController().signal,
  waits: timeless,
});

export const textOf = ({ content }: ModelMessage): string => content.map(({ text }) => text).join('');

export const textsOf = ({ messages }: ModelRequest): readonly string[] => messages.map((message) => textOf(message));

interface Pending {
  readonly due: number;
  readonly resolve: () => void;
}

export function manualClock() {
  const state = { at: 0 };
  const pending = new Set<Pending>();
  const waits: Waits = (ms) => {
    const { promise: elapsed, resolve } = Promise.withResolvers<void>();
    const entry: Pending = { due: state.at + ms, resolve };
    pending.add(entry);
    return {
      elapsed,
      stop: () => {
        pending.delete(entry);
      },
    };
  };
  const advance = (ms: number) => {
    state.at += ms;
    for (const entry of [...pending].filter(({ due }) => due <= state.at)) {
      pending.delete(entry);
      entry.resolve();
    }
  };
  return { now: () => state.at, waits, advance, pending };
}

export function stalling() {
  const stall = Promise.withResolvers<void>();
  return {
    stalled: (): Promise<void> => stall.promise,
    neverAnswering: <A>(): Promise<A> => {
      stall.resolve();
      return neverSettled();
    },
  };
}
