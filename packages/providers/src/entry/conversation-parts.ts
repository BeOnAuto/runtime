import type { RenderClock } from '@on.auto/definitions/template';
import { pointerIssues, templatesIssues, type TemplateSet } from '@on.auto/definitions/tool-blocks';
import { ClientSourceSchema } from '@on.auto/tool-servers';
import { isToolName, toolNameShape } from '@on.auto/tool-servers/policy';
import { JsonPointer, Schema } from 'effect';

const ArgumentsSchema = Schema.Record(Schema.String, Schema.Json);

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

interface Placed {
  readonly pointer: string;
  readonly detail: string;
}

const noLines: ReadonlyMap<string, number> = new Map();

const checkedOn: RenderClock = () => performance.now();

function pathOf(pointer: string): readonly string[] {
  return pointer
    .split('/')
    .slice(1)
    .map((token) => JsonPointer.unescapeToken(token));
}

function issuesOf(placed: readonly Placed[]): readonly PartIssue[] {
  return placed.map(({ pointer, detail }) => ({ path: pathOf(pointer), issue: detail }));
}

function toolIssues(pointer: string, tool: string): readonly Placed[] {
  return isToolName(tool) ? [] : [{ pointer, detail: `Expected ${toolNameShape}` }];
}

function argumentIssues(pointer: string, written: Conversations['reply']['with']): readonly Placed[] {
  return templatesIssues(conversationTemplates, written, {
    lines: noLines,
    pointer,
    inputSchema: undefined,
    clock: checkedOn,
  });
}

export function conversationIssuesOf(conversations: Conversations | undefined): readonly PartIssue[] {
  if (conversations === undefined) {
    return [];
  }
  const { reply, react, automatic } = conversations;
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
  ]);
}
