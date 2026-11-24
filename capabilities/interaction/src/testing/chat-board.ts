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

export interface Edit {
  readonly channel: string;
  readonly ts: string;
  readonly text: string;
  readonly blocks: unknown;
}

export interface ChatBoard {
  readonly answerOf: (call: OneCall) => BoardAnswer;
  readonly posted: () => readonly ChatMessage[];
  readonly reactions: () => readonly Reaction[];
  readonly edits: () => readonly Edit[];
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

function reactionOn(record: (reaction: Reaction) => void, call: OneCall): BoardAnswer {
  record({
    channel: argument(call, 'channel'),
    timestamp: argument(call, 'timestamp'),
    name: argument(call, 'name'),
  });
  return answered({ ok: true });
}

function editOn(record: (edit: Edit) => void, call: OneCall): BoardAnswer {
  const channel = argument(call, 'channel');
  const ts = argument(call, 'ts');
  record({ channel, ts, text: argument(call, 'text'), blocks: call.input['blocks'] });
  return answered({ ok: true, channel, ts });
}

function recorder<Item>() {
  const items: Item[] = [];
  return {
    record: (item: Item): void => {
      items.push(item);
    },
    all: (): readonly Item[] => [...items],
  };
}

export function chatBoard(already: readonly ChatMessage[] = [], postsAs = playbookUser): ChatBoard {
  const messages: ChatMessage[] = [...already];
  const sentThroughTheTool = new Set(already.filter(({ user }) => user === playbookUser).map(({ ts }) => ts));
  const reactions = recorder<Reaction>();
  const edits = recorder<Edit>();
  const react = (call: OneCall): BoardAnswer => reactionOn(reactions.record, call);
  const update = (call: OneCall): BoardAnswer => editOn(edits.record, call);
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
      const answering =
        { thread_replies: read, add_reaction: react, update_message: update }[call.reference.tool] ?? post;
      return answering(call);
    },
    reactions: reactions.all,
    edits: edits.all,
    posted: () => messages.filter(({ ts }) => sentThroughTheTool.has(ts)),
    reply: ({ channel, thread, user, text }) => {
      const ts = nextTs();
      messages.push({ ts, channel, user, ...(text === undefined ? {} : { text }), ...threadOf(thread ?? '') });
      return ts;
    },
  };
}
