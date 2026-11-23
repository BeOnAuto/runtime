import type { Waits } from '@on.auto/chat';
import type { ChatRendering } from '@on.auto/interaction';
import type { ChatMessage } from '@on.auto/providers';

import type { Knowing } from '../people/who-is-who.ts';
import type { ChatService, WhereWritten } from '../service/service-calls.ts';
import type { ChatStore } from '../store/chat-store.ts';
import type { Arrival, ConversationPlace, MemberOfAnAccount } from '../tables/chat-rows.ts';
import type { InProcessDirectory } from '../turn/in-process-directory.ts';
import type { TurnModels } from '../turn/turn-model.ts';
import type { ShownNowhere } from '../turn/working-status.ts';

export const MENTION = 'mention';

export const AMBIENT = 'ambient';

export const DIRECT_MESSAGE = 'direct_message';

export interface ChatConnection {
  readonly connection: string;
  readonly account: string;
  readonly service: ChatService;
  readonly render: ChatRendering;
  readonly model: string | null;
  readonly accountName: string | undefined;
  readonly requestSentAs: (conversation: string, id: string) => Promise<boolean>;
  readonly requestWaitsIn: (conversation: string) => Promise<boolean>;
  readonly notShownHere: ShownNowhere;
}

export interface ChatServing {
  readonly store: ChatStore;
  readonly knowing: Knowing;
  readonly models: TurnModels;
  readonly directory: InProcessDirectory;
  readonly directoryUrl: string;
  readonly now: () => number;
  readonly waits: Waits;
}

export type Holding = 'check' | 'turn';

export interface HeldHere {
  readonly holding: Holding;
  readonly over: Promise<void>;
}

export interface LeaseHolder {
  readonly answering: () => void;
  readonly released: () => void;
}

export interface LeaseHolders {
  readonly heldHere: (conversation: string) => HeldHere | undefined;
  readonly held: (conversation: string, holding: Holding) => LeaseHolder;
}

export interface ServingNow extends ChatServing {
  readonly signal: Readonly<AbortSignal>;
  readonly holders: LeaseHolders;
  readonly renewalFailed: (cause: unknown) => void;
}

export type Routed = 'person' | 'ambient' | 'passed';

export type Claimed = 'run' | 'dropped';

export interface Taking {
  readonly message: ChatMessage;
  readonly arrival: Arrival;
  readonly connection: ChatConnection;
}

export function whereOf({ id, conversation, thread, sender, kind }: ChatMessage): WhereWritten {
  return { id, conversation, thread, sender, kind };
}

function threadAnsweredIn({ id, thread, kind }: ChatMessage): string | undefined {
  return kind === DIRECT_MESSAGE ? thread : (thread ?? id);
}

export function placeOf({ connection, account }: ChatConnection, message: ChatMessage): ConversationPlace {
  return { connection, account, conversation: message.conversation, thread: threadAnsweredIn(message) };
}

export function memberOf({ account }: ChatConnection, { sender }: ChatMessage): MemberOfAnAccount {
  return { account, member: sender };
}
