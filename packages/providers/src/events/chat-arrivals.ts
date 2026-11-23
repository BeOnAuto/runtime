import { applies, declaredValueIn, holds, isItsOwn, textIn, valueIn, type Arrival } from './arrival-readings.ts';
import type { Destination } from './destination-fields.ts';
import { eventTimeOf } from './event-times.ts';

type DeclaredChat = NonNullable<Destination['chat']>[number];

export interface ChatMessage {
  readonly kind: DeclaredChat['kind'];
  readonly id: string;
  readonly conversation: string;
  readonly thread?: string;
  readonly sender: string;
  readonly account?: string;
  readonly text: string;
  readonly time?: string;
  readonly shared: boolean;
  readonly app?: string;
}

type Written = Pick<ChatMessage, 'id' | 'conversation' | 'sender' | 'text'>;

function writtenIn(arrival: Arrival, declared: DeclaredChat): Written | undefined {
  const id = textIn(arrival, declared.id);
  const conversation = textIn(arrival, declared.conversation);
  const sender = textIn(arrival, declared.sender);
  const text = valueIn(arrival, declared.text);
  return id === undefined || conversation === undefined || sender === undefined || typeof text !== 'string'
    ? undefined
    : { id, conversation, sender, text };
}

function isAReplyInAThread(id: string, thread: string | undefined): boolean {
  return thread !== undefined && thread !== id;
}

function accountIn(arrival: Arrival, expressions: readonly string[] = []): Pick<ChatMessage, 'account'> {
  const account = expressions.map((expression) => textIn(arrival, expression)).find((named) => named !== undefined);
  return account === undefined ? {} : { account };
}

function timeIn(arrival: Arrival, expression: string | undefined): Pick<ChatMessage, 'time'> {
  const time = eventTimeOf(declaredValueIn(arrival, expression));
  return time === undefined ? {} : { time };
}

function isShared(arrival: Arrival, expression: string | undefined): boolean {
  return expression !== undefined && declaredValueIn(arrival, expression) !== false;
}

function appIn(arrival: Arrival, own: DeclaredChat['own']): Pick<ChatMessage, 'app'> {
  const app = own === undefined ? undefined : textIn(arrival, own[1]);
  return app === undefined ? {} : { app };
}

function isAPersonsNewMessage(arrival: Arrival, declared: DeclaredChat): boolean {
  return (
    !applies(arrival, declared.automatic) && !applies(arrival, declared.changed) && !isItsOwn(arrival, declared.own)
  );
}

function personsWrittenIn(arrival: Arrival, declared: DeclaredChat): Written | undefined {
  return isAPersonsNewMessage(arrival, declared) ? writtenIn(arrival, declared) : undefined;
}

export function chatMessageIn({ chat = [] }: Destination, arrival: Arrival): ChatMessage | undefined {
  const declared = chat.find(({ when }) => holds(arrival, when));
  const written = declared === undefined ? undefined : personsWrittenIn(arrival, declared);
  if (declared === undefined || written === undefined) {
    return undefined;
  }
  const thread = textIn(arrival, declared.thread);
  if (declared.kind === 'ambient' && !isAReplyInAThread(written.id, thread)) {
    return undefined;
  }
  return {
    kind: declared.kind,
    ...written,
    ...(thread === undefined ? {} : { thread }),
    ...accountIn(arrival, declared.account),
    ...timeIn(arrival, declared.time),
    shared: isShared(arrival, declared.shared),
    ...appIn(arrival, declared.own),
  };
}
