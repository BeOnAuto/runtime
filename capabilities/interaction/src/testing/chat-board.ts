import type { AnsweredOnce, CallAnswer, OneCall } from '@on.auto/tool-servers';

interface Answering {
  readonly detail: string;
  readonly retryAfterMs: number | null;
}

export type BoardAnswer =
  | (Answering & { readonly outcome: 'result'; readonly answer: CallAnswer })
  | (Answering & { readonly outcome: Exclude<AnsweredOnce['outcome'], 'result'> });

export interface ChatMessage {
  readonly ts: string;
  readonly channel: string;
  readonly user: string;
  readonly text?: string;
  readonly thread_ts?: string;
}

export interface Replying {
  readonly channel: string;
  readonly thread?: string | undefined;
  readonly user: string;
  readonly text?: string;
}

export interface Reaction {
  readonly channel: string;
  readonly timestamp: string;
  readonly name: string;
}

export interface ChatBoard {
  readonly answerOf: (call: OneCall) => BoardAnswer;
  readonly posted: () => readonly ChatMessage[];
  readonly reactions: () => readonly Reaction[];
  readonly reply: (replying: Replying) => string;
}

export const playbookUser = 'playbook';

function argument(call: OneCall, name: string): string {
  const value = call.input[name];
  return typeof value === 'string' ? value : '';
}

export function answered(document: unknown): BoardAnswer {
  return {
    outcome: 'result',
    answer: { content: [{ type: 'text', text: JSON.stringify(document) }] },
    detail: '',
    retryAfterMs: null,
  };
}

export function answeredInAFile(document: unknown): BoardAnswer {
  const text = JSON.stringify(document);
  return {
    outcome: 'result',
    answer: {
      content: [{ type: 'resource', resource: { uri: 'file:///answer.json', mimeType: 'application/json', text } }],
    },
    detail: '',
    retryAfterMs: null,
  };
}

function threadOf(thread: string) {
  return thread === '' ? {} : { thread_ts: thread };
}

export function chatBoard(already: readonly ChatMessage[] = [], postsAs = playbookUser): ChatBoard {
  const messages: ChatMessage[] = [...already];
  const sentThroughTheTool = new Set(already.filter(({ user }) => user === playbookUser).map(({ ts }) => ts));
  const reactions: Reaction[] = [];
  const react = (call: OneCall): BoardAnswer => {
    reactions.push({
      channel: argument(call, 'channel'),
      timestamp: argument(call, 'timestamp'),
      name: argument(call, 'name'),
    });
    return answered({ ok: true });
  };
  const nextTs = () => `1699.${String(messages.length + 1).padStart(6, '0')}`;
  const post = (call: OneCall): BoardAnswer => {
    const ts = nextTs();
    const channel = argument(call, 'channel');
    messages.push({
      ts,
      channel,
      user: postsAs,
      text: argument(call, 'text'),
      ...threadOf(argument(call, 'thread_ts')),
    });
    sentThroughTheTool.add(ts);
    return answered({ ok: true, channel, ts });
  };
  const read = (call: OneCall): BoardAnswer => {
    const ts = argument(call, 'ts');
    const oldest = Number(argument(call, 'oldest'));
    const inThread = (message: ChatMessage) => ts === '' || message.ts === ts || message.thread_ts === ts;
    return answered({
      messages: messages.filter(
        (message) => message.channel === argument(call, 'channel') && inThread(message) && Number(message.ts) > oldest,
      ),
    });
  };
  return {
    answerOf: (call) => {
      const answering = { thread_replies: read, add_reaction: react }[call.reference.tool] ?? post;
      return answering(call);
    },
    reactions: () => [...reactions],
    posted: () => messages.filter(({ ts }) => sentThroughTheTool.has(ts)),
    reply: ({ channel, thread, user, text }) => {
      const ts = nextTs();
      messages.push({ ts, channel, user, ...(text === undefined ? {} : { text }), ...threadOf(thread ?? '') });
      return ts;
    },
  };
}
