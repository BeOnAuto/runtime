import { renderClock } from '@on.auto/definitions/template';
import { omitVariables, renderedArguments, textAt, valueAt } from '@on.auto/definitions/tool-blocks';
import type { RenderedMessage, WrittenInAThread } from '@on.auto/interaction';
import { typingShownBy, type ProviderEntry, type ThroughTheConnection } from '@on.auto/providers';
import { answerDocument, type CalledOnce, type ConnectionWays } from '@on.auto/tool-servers';
import { Effect, Result, type Schema } from 'effect';

type Chat = NonNullable<ProviderEntry['chat']>;

type Typing = NonNullable<NonNullable<ProviderEntry['conversations']>['typing']>;

type Called =
  | Chat['answer']
  | Chat['thread']
  | Chat['sender']
  | NonNullable<Chat['ephemeral']>
  | Chat['answer']['replace'];

export interface WhereWritten {
  readonly id: string;
  readonly conversation: string;
  readonly thread: string | undefined;
  readonly sender: string;
  readonly kind: string;
}

export type Posting = string | RenderedMessage;

export interface SenderRead {
  readonly email: string | undefined;
  readonly verified: boolean;
  readonly account: string | undefined;
  readonly active: boolean;
  readonly name: string | undefined;
}

export type Shown = 'shown' | 'refused' | 'failed';

export interface ChatService {
  readonly answered: (where: WhereWritten, message: Posting) => Promise<string | undefined>;
  readonly replaced: (where: WhereWritten, sent: string, message: string) => Promise<boolean>;
  readonly toldAlone: (where: WhereWritten, message: Posting) => Promise<boolean>;
  readonly thread: (where: WhereWritten) => Promise<readonly WrittenInAThread[]>;
  readonly sender: (where: WhereWritten) => Promise<SenderRead | undefined>;
  readonly typing: (where: WhereWritten) => Promise<Shown>;
}

export interface ChatCalls extends ConnectionWays, Pick<ThroughTheConnection, 'mostRequestBytesTo'> {}

export interface ThroughAConnection {
  readonly org: string;
  readonly connection: { readonly id: string; readonly name: string };
  readonly chat: Chat;
  readonly typing: Typing | undefined;
  readonly failureCodes: ProviderEntry['failure_codes'];
  readonly tools: ChatCalls;
}

type Variables = Readonly<Record<string, Schema.Json>>;

function postingOf(message: Posting): Variables {
  return typeof message === 'string' ? { message } : { message: message.text, rendered: message.payload };
}

function variablesOf({ id, conversation, thread, sender, kind }: WhereWritten, message: Posting): Variables {
  return {
    id,
    conversation,
    sender,
    kind,
    ...postingOf(message),
    ...(thread === undefined ? {} : { thread }),
    ...omitVariables(),
  };
}

const unrendered = 'unrendered';

function answeredDocument(called: CalledOnce | undefined | typeof unrendered): Schema.Json | undefined {
  return called !== undefined && called !== unrendered && called.kind === 'answered' && called.outcome === 'result'
    ? answerDocument(called.answer)
    : undefined;
}

function calledAsTheConnection({ org, connection, tools }: ThroughAConnection) {
  return (tool: string, input: Readonly<Record<string, unknown>>) =>
    tools.callAsTheConnection({ org, connection: connection.id, tool, input });
}

function calledThrough(through: ThroughAConnection, declared: Called, variables: Variables) {
  return Effect.gen(function* () {
    const mostBytes = through.tools.mostRequestBytesTo(through.connection.name);
    const rendered = renderedArguments(declared.with, variables, yield* renderClock, mostBytes);
    if (Result.isFailure(rendered)) {
      return unrendered;
    }
    return yield* calledAsTheConnection(through)(declared.tool, rendered.success.input);
  });
}

async function documentOf(through: ThroughAConnection, declared: Called, variables: Variables) {
  const called = calledThrough(through, declared, variables).pipe(
    Effect.catchCause(() => Effect.succeed<typeof unrendered>(unrendered)),
  );
  return answeredDocument(await Effect.runPromise(called));
}

function heldBy(document: unknown, pointer: string, values: readonly (string | boolean | null)[]): boolean {
  const value = valueAt(document, pointer) ?? null;
  return values.includes(value === null || typeof value === 'string' || typeof value === 'boolean' ? value : '');
}

function isActive(document: unknown, active: Chat['sender']['active']): boolean {
  return Object.entries(active ?? {}).every(
    ([pointer, values]: readonly [string, readonly (string | boolean | null)[]]) => heldBy(document, pointer, values),
  );
}

function senderIn(document: unknown, declared: Chat['sender']): SenderRead {
  const verified = declared.email_verified !== undefined && valueAt(document, declared.email_verified) === true;
  return {
    email: textAt(document, declared.email),
    verified,
    account: declared.account === undefined ? undefined : textAt(document, declared.account),
    active: isActive(document, declared.active),
    name: textAt(document, declared.name),
  };
}

function writtenIn(item: unknown, each: Chat['thread']['read']['each']): readonly WrittenInAThread[] {
  const id = textAt(item, each.id);
  const text = valueAt(item, each.text);
  if (id === undefined || typeof text !== 'string') {
    return [];
  }
  const automatic = each.automatic === undefined ? undefined : textAt(item, each.automatic);
  return [{ id, sender: textAt(item, each.sender), text, automatic }];
}

function threadIn(document: unknown, { list, order, each }: Chat['thread']['read']): readonly WrittenInAThread[] {
  const listed = valueAt(document, list);
  const read = Array.isArray(listed) ? listed.flatMap((item: unknown) => writtenIn(item, each)) : [];
  return order === 'oldest_first' ? read : read.toReversed();
}

export function chatServiceThrough(through: ThroughAConnection): ChatService {
  const { chat } = through;
  const answered: ChatService['answered'] = async (where, message) => {
    const document = await documentOf(through, chat.answer, variablesOf(where, message));
    return document === undefined ? undefined : textAt(document, chat.answer.sent);
  };
  return {
    answered,
    replaced: async (where, sent, message) =>
      (await documentOf(through, chat.answer.replace, { ...variablesOf(where, message), sent: { id: sent } })) !==
      undefined,
    toldAlone: async (where, message) =>
      chat.ephemeral !== undefined &&
      (await documentOf(through, chat.ephemeral, variablesOf(where, message))) !== undefined,
    thread: async (where) => threadIn(await documentOf(through, chat.thread, variablesOf(where, '')), chat.thread.read),
    sender: async (where) => {
      const document = await documentOf(through, chat.sender, variablesOf(where, ''));
      return document === undefined ? undefined : senderIn(document, chat.sender);
    },
    typing: ({ id, conversation, thread, sender }) => {
      const { connection, typing, failureCodes, tools } = through;
      if (typing === undefined) {
        return Promise.resolve('refused');
      }
      const to = thread ?? id;
      const repliedIn = { to: sender, sent: { conversation, id: to }, reply: { id, to } };
      const mostBytes = tools.mostRequestBytesTo(connection.name);
      return Effect.runPromise(
        typingShownBy(calledAsTheConnection(through), mostBytes, { typing, failureCodes, repliedIn }),
      );
    },
  };
}
