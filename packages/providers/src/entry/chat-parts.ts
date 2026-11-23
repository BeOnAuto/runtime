import { omitVariables, pointerIssues, type TemplateSet } from '@on.auto/definitions/tool-blocks';
import { JsonPointer, Schema } from 'effect';

import { AnswerConditionsSchema, noCondition } from './answer-conditions.ts';
import { ArgumentsSchema, argumentIssuesOver, issuesOf, noLines, toolIssues, type Placed } from './part-checks.ts';

const overAMessage = [
  "Its arguments, written as the arguments of a function's deliver are.",
  "Each one is a Liquid template that can read these of the person's message: id, conversation, sender, thread where the message is in a thread, and kind, which is mention, direct_message or ambient.",
  'It can also read message, the words Auto posts, and rendered, the same message laid out as the service takes it, where the message has more than words.',
  'An argument whose template renders omit, as {{ thread | default: omit }} does for a message in no thread, is left out of the call.',
].join(' ');

const ToolSchema = Schema.String;

const PostSchema = Schema.Struct({
  tool: ToolSchema.annotate({
    description: "The tool that posts a message in the thread of a person's message, named as the server lists it",
  }),
  with: ArgumentsSchema.annotate({ description: overAMessage }),
  sent: Schema.String.annotate({
    description: 'A JSON Pointer into what the tool answered, to the id of the message it posted',
  }),
  replace: Schema.Struct({
    tool: ToolSchema.annotate({
      description: 'The tool that replaces the words of a message Auto posted, named as the server lists it',
    }),
    with: ArgumentsSchema.annotate({
      description: `${overAMessage} Its arguments can also read sent.id, the message Auto posted.`,
    }),
  }).annotate({
    description: 'How Auto turns a message it posted, such as one that says it is working, into its answer',
  }),
});

const EphemeralSchema = Schema.Struct({
  tool: ToolSchema.annotate({
    description: 'The tool that posts a line only one person sees, named as the server lists it',
  }),
  with: ArgumentsSchema.annotate({ description: overAMessage }),
});

const EachMessageSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'A JSON Pointer within each message to its identity' }),
  sender: Schema.String.annotate({ description: 'A JSON Pointer within each message to who wrote it' }),
  text: Schema.String.annotate({ description: 'A JSON Pointer within each message to its words' }),
  time: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'A JSON Pointer within each message to when it was written: RFC 3339 text, or seconds since the epoch',
    }),
  ),
  automatic: Schema.optionalKey(
    Schema.String.annotate({
      description: 'A JSON Pointer within each message to what it holds only when an app posted it',
    }),
  ),
});

const ThreadSchema = Schema.Struct({
  tool: ToolSchema.annotate({
    description: 'The tool that reads the messages of a thread, named as the server lists it',
  }),
  with: ArgumentsSchema.annotate({ description: overAMessage }),
  read: Schema.Struct({
    list: Schema.String.annotate({
      description: "A JSON Pointer into what the tool answered, to the thread's messages",
    }),
    order: Schema.Literals(['oldest_first', 'newest_first']).annotate({
      description: 'The order the tool lists them in',
    }),
    each: EachMessageSchema,
  }).annotate({ description: "Where, in what the tool answered, the thread's messages are" }),
});

const SenderSchema = Schema.Struct({
  tool: ToolSchema.annotate({
    description: 'The tool that reads a person at the service, named as the server lists it',
  }),
  with: ArgumentsSchema.annotate({ description: overAMessage }),
  email: Schema.String.annotate({
    description: "A JSON Pointer into what the tool answered, to the person's email address",
  }),
  email_verified: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "A JSON Pointer to the boolean that is true where the service confirmed that the address is the person's. Where it is left out, Auto counts no address as confirmed, and asks each person to sign in instead.",
    }),
  ),
  account: Schema.optionalKey(
    Schema.String.annotate({
      description: 'A JSON Pointer to the id of the account the person belongs to, such as a workspace',
    }),
  ),
  name: Schema.String.annotate({
    description:
      "A JSON Pointer into what the tool answered, to the person's name. Auto shows this name on the page where the person allows the connection to Auto. Without a name there, the person cannot connect their account.",
  }),
  active: Schema.optionalKey(
    AnswerConditionsSchema.annotate({
      description:
        'Conditions on what the tool answered that hold only for an active person of the account, and not for one who was deactivated, has not joined yet or is an app: each a JSON Pointer with the values it may equal, every one of which holds. Put null among the values to let a field that is missing or null pass',
    }),
  ),
});

export const ChatSchema = Schema.Struct({
  answer: PostSchema.annotate({ description: "How Auto posts its answer in the thread of a person's message" }),
  ephemeral: Schema.optionalKey(
    EphemeralSchema.annotate({
      description:
        'How Auto posts a line that only the person who wrote the message sees, where the provider has such a message',
    }),
  ),
  thread: ThreadSchema.annotate({ description: 'How Auto reads the messages of the thread a person wrote in' }),
  sender: SenderSchema.annotate({
    description:
      "How Auto reads the person who wrote a message, to know who they are. When Auto reads a person's name before they connect, no message exists: id and sender are the person, and conversation and kind are empty.",
  }),
}).annotate({
  description:
    "How Auto answers a person who writes to it where the provider's app reads, for a provider whose destination says under chat which messages a person wrote. Only a provider that ships with the runtime can declare it",
});

type Chat = typeof ChatSchema.Type;

function chatTemplates(): TemplateSet {
  return {
    names: ['id', 'conversation', 'thread', 'sender', 'kind', 'message', 'rendered', 'sent.id', 'omit'],
    what: 'a template of a chat',
    sample: {
      id: '1699.2',
      conversation: 'C0123',
      thread: '1699.1',
      sender: 'ada',
      kind: 'mention',
      message: 'A line',
      rendered: [{ type: 'section', text: 'A line' }],
      sent: { id: '1699.3' },
      ...omitVariables(),
    },
    structured: 'sent',
  };
}

interface Called {
  readonly tool: string;
  readonly with: typeof ArgumentsSchema.Type;
}

function calledIssues(at: string, { tool, with: written }: Called): readonly Placed[] {
  return [...toolIssues(`${at}/tool`, tool), ...argumentIssuesOver(chatTemplates(), `${at}/with`, written)];
}

function answerIssues(answer: Chat['answer']): readonly Placed[] {
  return [
    ...calledIssues('/chat/answer', answer),
    ...pointerIssues(noLines, [['/chat/answer/sent', answer.sent]]),
    ...calledIssues('/chat/answer/replace', answer.replace),
  ];
}

function threadIssues(thread: Chat['thread']): readonly Placed[] {
  const { list, each } = thread.read;
  return [
    ...calledIssues('/chat/thread', thread),
    ...pointerIssues(noLines, [
      ['/chat/thread/read/list', list],
      ...Object.entries(each).map(([place, pointer]: readonly [string, string]): readonly [string, string] => [
        `/chat/thread/read/each/${place}`,
        pointer,
      ]),
    ]),
  ];
}

function activeIssues(active: NonNullable<Chat['sender']['active']>): readonly Placed[] {
  const pointers = Object.keys(active);
  return pointers.length === 0
    ? [{ pointer: '/chat/sender/active', detail: noCondition }]
    : pointerIssues(
        noLines,
        pointers.map((pointer): readonly [string, string] => [
          `/chat/sender/active/${JsonPointer.escapeToken(pointer)}`,
          pointer,
        ]),
      );
}

function senderIssues(sender: Chat['sender']): readonly Placed[] {
  return [
    ...calledIssues('/chat/sender', sender),
    ...pointerIssues(noLines, [
      ['/chat/sender/email', sender.email],
      ['/chat/sender/email_verified', sender.email_verified],
      ['/chat/sender/account', sender.account],
      ['/chat/sender/name', sender.name],
    ]),
    ...(sender.active === undefined ? [] : activeIssues(sender.active)),
  ];
}

interface WithChats {
  readonly destinations: readonly { readonly chat?: unknown }[];
}

const unanswered = 'Expected chat at the top of the entry as well, which says how Auto answers what these messages ask';

function unansweredIssues(events: WithChats | undefined): readonly Placed[] {
  return (events?.destinations ?? []).flatMap(({ chat }, index): readonly Placed[] =>
    chat === undefined ? [] : [{ pointer: `/events/destinations/${String(index)}/chat`, detail: unanswered }],
  );
}

export function chatIssuesOf(chat: Chat | undefined, events: WithChats | undefined): readonly Schema.FilterIssue[] {
  if (chat === undefined) {
    return issuesOf(unansweredIssues(events));
  }
  return issuesOf([
    ...answerIssues(chat.answer),
    ...(chat.ephemeral === undefined ? [] : calledIssues('/chat/ephemeral', chat.ephemeral)),
    ...threadIssues(chat.thread),
    ...senderIssues(chat.sender),
  ]);
}
