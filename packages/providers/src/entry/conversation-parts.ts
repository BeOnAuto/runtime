import { pointerIssues, textAt, type TemplateSet } from '@on.auto/definitions/tool-blocks';
import { ClientSourceSchema, type AnsweredOnce, type CalledOnce, type ServerEntrySchema } from '@on.auto/tool-servers';
import { Option, Schema } from 'effect';

import { ArgumentsSchema, argumentIssuesOver, issuesOf, noLines, toolIssues, type Placed } from './part-checks.ts';

const variablesRead = 'to, sent.conversation, sent.id, message, reply.id and reply.to';

const writtenAsDeliverIs = `written as the arguments of a function's deliver are, each a Liquid template over ${variablesRead}`;

const ReplySchema = Schema.Struct({
  tool: Schema.String.annotate({
    description: "The tool that posts a message in the conversation of a person's reply, named as the server lists it",
  }),
  with: ArgumentsSchema.annotate({
    description: `Its arguments, ${writtenAsDeliverIs}: message is the line, and reply.to the message the person's reply answers`,
  }),
  sent: Schema.String.annotate({
    description: 'A JSON Pointer into what the tool answered, to the id of the message it posted',
  }),
});

const ReactSchema = Schema.Struct({
  tool: Schema.String.annotate({
    description: "The tool that marks a person's message with a reaction, named as the server lists it",
  }),
  with: ArgumentsSchema.annotate({ description: `Its arguments, ${writtenAsDeliverIs}` }),
});

const TypingSchema = Schema.Struct({
  tool: Schema.String.annotate({
    description: 'The tool that shows that Auto is working, named as the server lists it',
  }),
  with: ArgumentsSchema.annotate({ description: `Its arguments, ${writtenAsDeliverIs}` }),
  refused: Schema.optionalKey(
    Schema.Array(Schema.String).check(Schema.isMinLength(1)).annotate({
      description:
        'The codes the tool answers when the service does not show this sign for the account at all, such as for a scope the credential lacks or a feature that is turned off',
    }),
  ),
});

const ReadLimitSchema = Schema.Struct({
  quota: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: 'The most reads of a conversation the service takes in one window',
  }),
  window_seconds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(86_400)).annotate({
    description: 'The window, in seconds, from 1 to 86400',
  }),
  clients: Schema.optionalKey(
    Schema.Array(ClientSourceSchema).check(Schema.isMinLength(1)).annotate({
      description:
        'The client sources whose connections the service limits so, where it limits some apps and not others; left out, every connection',
    }),
  ),
}).annotate({
  description:
    "How often the service lets the replies of a conversation be read, as a rate limit's quota and window: at most quota reads in each window. The runtime reads a conversation no sooner than the window divided by the quota after its last read, on its timer and when the service tells it of a message alike",
});

export const ConversationsSchema = Schema.Struct({
  tell: Schema.Literals(['all', 'refusals']).annotate({
    description:
      "The provider's practice, and what a person is told through it by a function that writes no tell: all where one more message is expected, as in a chat, so a reply taken is marked and answered, a reply not taken is answered and a request that ends says so; refusals where each message costs, as in mail or a text message, so only a reply that could not be taken is answered",
  }),
  reply: ReplySchema.annotate({ description: 'How a line is posted in reply to a person' }),
  react: Schema.optionalKey(ReactSchema.annotate({ description: "How a person's message is marked" })),
  typing: Schema.optionalKey(
    TypingSchema.annotate({ description: 'How the provider shows a person that Auto is working on their reply' }),
  ),
  read_limit: Schema.optionalKey(ReadLimitSchema),
  automatic: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'A JSON Pointer within a message the reading tool lists, to what it holds only when an app posted it or it was sent automatically; such a message is passed over, never taken, refused or answered',
    }),
  ),
}).annotate({
  description:
    "How the provider's conversations are replied to and marked, for a function that asks a person through it and reads their replies",
});

export type Conversations = typeof ConversationsSchema.Type;

export const conversationTemplates: TemplateSet = {
  names: ['to', 'sent.conversation', 'sent.id', 'message', 'reply.id', 'reply.to'],
  what: 'a template of a conversation',
  sample: {
    to: 'ada',
    sent: { conversation: 'C0123', id: '1699.1' },
    message: 'A line',
    reply: { id: '1699.2', to: '1699.1' },
  },
  structured: 'sent',
};

type PartIssue = Schema.FilterIssue;

function argumentIssues(pointer: string, written: Conversations['reply']['with']): readonly Placed[] {
  return argumentIssuesOver(conversationTemplates, pointer, written);
}

type FailureCodes = NonNullable<(typeof ServerEntrySchema)['Type']['failure_codes']>;

type Typing = NonNullable<Conversations['typing']>;

const refusedAt = '/conversations/typing/refused';

const refusedWords = {
  uncoded:
    'Expected failure_codes in the entry as well, since they say where a failed answer gives the code that refused lists',
  partly: (kind: string) =>
    `Expected every code failure_codes lists under ${kind}, or none of them, since Auto learns only that a call failed as ${kind}, not which of those codes it was`,
} as const;

function codeListsOf(codes: FailureCodes): ReadonlyMap<string, readonly string[]> {
  return new Map(
    Object.entries(codes).flatMap(([kind, listed]: readonly [string, string | readonly string[]]) =>
      typeof listed === 'string' ? [] : [[kind, listed] as const],
    ),
  );
}

function partlyListed(refused: readonly string[], codes: FailureCodes): readonly Placed[] {
  return [...codeListsOf(codes)].flatMap(([kind, listed]: readonly [string, readonly string[]]) => {
    const among = listed.filter((code) => refused.includes(code)).length;
    return among === 0 || among === listed.length ? [] : [{ pointer: refusedAt, detail: refusedWords.partly(kind) }];
  });
}

function refusedIssues({ refused }: Typing, codes: FailureCodes | undefined): readonly Placed[] {
  if (refused === undefined) {
    return [];
  }
  return codes === undefined ? [{ pointer: refusedAt, detail: refusedWords.uncoded }] : partlyListed(refused, codes);
}

function typingIssues(typing: Typing | undefined, codes: FailureCodes | undefined): readonly Placed[] {
  if (typing === undefined) {
    return [];
  }
  return [
    ...toolIssues('/conversations/typing/tool', typing.tool),
    ...argumentIssues('/conversations/typing/with', typing.with),
    ...refusedIssues(typing, codes),
  ];
}

export function conversationIssuesOf(
  conversations: Conversations | undefined,
  codes: FailureCodes | undefined,
): readonly PartIssue[] {
  if (conversations === undefined) {
    return [];
  }
  const { reply, react, typing, automatic } = conversations;
  return issuesOf([
    ...toolIssues('/conversations/reply/tool', reply.tool),
    ...argumentIssues('/conversations/reply/with', reply.with),
    ...pointerIssues(noLines, [
      ['/conversations/reply/sent', reply.sent],
      ['/conversations/automatic', automatic],
    ]),
    ...(react === undefined
      ? []
      : [
          ...toolIssues('/conversations/react/tool', react.tool),
          ...argumentIssues('/conversations/react/with', react.with),
        ]),
    ...typingIssues(typing, codes),
  ]);
}

const decodeAnswer = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

function codeAnsweredIn(text: string, pointer: string): string | undefined {
  const answer = decodeAnswer(text);
  return Option.isSome(answer) ? textAt(answer.value, pointer) : undefined;
}

function isAListedCode(called: AnsweredOnce, refused: readonly string[], codes: FailureCodes): boolean {
  const code = called.outcome === 'tool_error' ? codeAnsweredIn(called.detail, codes.code) : undefined;
  return code !== undefined && refused.includes(code);
}

function isAListedFailure(called: AnsweredOnce, refused: readonly string[], codes: FailureCodes): boolean {
  const kind = 'because' in called ? called.because : undefined;
  const listed = kind === undefined ? undefined : codeListsOf(codes).get(kind);
  return listed !== undefined && listed.every((code) => refused.includes(code));
}

export function isRefusedForTheAccount(called: CalledOnce, { refused = [] }: Typing, codes?: FailureCodes): boolean {
  if (called.kind === 'unopened' || codes === undefined) {
    return false;
  }
  return isAListedCode(called, refused, codes) || isAListedFailure(called, refused, codes);
}
