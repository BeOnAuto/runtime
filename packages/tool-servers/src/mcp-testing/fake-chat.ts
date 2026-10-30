export interface ChatMessage {
  readonly ts: string;
  readonly channel: string;
  readonly user: string;
  readonly text?: string;
  readonly thread_ts?: string;
}

export interface ChatReply {
  readonly channel: string;
  readonly thread?: string | undefined;
  readonly user: string;
  readonly text: string;
}

export interface FakeChat {
  readonly echoed: Readonly<Record<string, string>>;
  readonly post: (input: unknown) => ChatMessage;
  readonly read: (input: unknown) => readonly ChatMessage[];
  readonly reply: (reply: ChatReply) => string;
  readonly posted: () => readonly ChatMessage[];
}

export const chatBot = 'playbook';

function argument(input: unknown, name: string): string {
  const value: unknown = Reflect.get(new Object(input), name);
  return typeof value === 'string' ? value : '';
}

function threadOf(thread: string) {
  return thread === '' ? {} : { thread_ts: thread };
}

function inThreadOf(thread: string) {
  return (message: ChatMessage) => thread === '' || message.ts === thread || message.thread_ts === thread;
}

export function fakeChat(echoing?: string): FakeChat {
  const messages: ChatMessage[] = [];
  const nextTs = () => `1699.${String(messages.length + 1).padStart(6, '0')}`;
  const kept = (message: ChatMessage) => {
    messages.push(message);
    return message;
  };
  return {
    echoed: echoing === undefined ? {} : { echo: echoing },
    post: (input) =>
      kept({
        ts: nextTs(),
        channel: argument(input, 'channel'),
        user: chatBot,
        text: argument(input, 'text'),
        ...threadOf(argument(input, 'thread_ts')),
      }),
    read: (input) => {
      const inThread = inThreadOf(argument(input, 'ts'));
      const oldest = Number(argument(input, 'oldest'));
      return messages.filter(
        (message) => message.channel === argument(input, 'channel') && inThread(message) && Number(message.ts) > oldest,
      );
    },
    reply: ({ channel, thread, user, text }) =>
      kept({ ts: nextTs(), channel, user, text, ...threadOf(thread ?? '') }).ts,
    posted: () => messages.filter(({ user }) => user === chatBot),
  };
}
