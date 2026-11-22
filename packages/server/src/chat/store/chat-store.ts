import type { KeptSecrets } from '@on.auto/openid-connect/authorization-server';
import { randomUUIDv7 } from '@on.auto/operations';

import { clockOf, type ChatClock, type ChatDatabase } from '../tables/chat-database.ts';
import type {
  AccountLink,
  Arrival,
  ArrivalKey,
  ChatRows,
  ConversationPlace,
  ConversationRow,
  LinkStart,
  MemberOfAnAccount,
} from '../tables/chat-rows.ts';
import { chatRowsOpened } from '../tables/chat-tables.ts';
import { chatDeletionsOver, type ChatDeletions } from './chat-deletions.ts';
import { leasedMemoryOf, type LeasedConversation, type Leasing } from './leased-memory.ts';
import { aConversationKey } from './sealed-texts.ts';

export const TURN_LEASE_MS = 12 * 60 * 1000;

export type LeaseTaken = { readonly leased: LeasedConversation } | { readonly running: true };

export interface ChatStore {
  readonly arrivals: {
    readonly claimed: (arrival: Arrival) => Promise<boolean>;
    readonly settled: (arrival: ArrivalKey) => Promise<void>;
    readonly unsettled: () => Promise<readonly Arrival[]>;
  };
  readonly conversations: {
    readonly found: (place: ConversationPlace) => Promise<ConversationRow | undefined>;
    readonly started: (place: ConversationPlace) => Promise<ConversationRow>;
    readonly leaseTaken: (conversation: ConversationRow) => Promise<LeaseTaken>;
  };
  readonly links: {
    readonly started: (start: LinkStart) => Promise<void>;
    readonly startFound: (secret: string) => Promise<LinkStart | undefined>;
    readonly startOf: (member: MemberOfAnAccount) => Promise<LinkStart | undefined>;
    readonly startEnded: (start: LinkStart) => Promise<boolean>;
    readonly linked: (link: AccountLink) => Promise<void>;
    readonly linkOf: (member: MemberOfAnAccount) => Promise<AccountLink | undefined>;
    readonly personForgotten: (person: string) => Promise<void>;
  };
  readonly deletions: ChatDeletions;
}

interface ChatStoreOptions {
  readonly now: ChatClock;
  readonly leaseMs?: number;
}

async function startedBy(leasing: Leasing, place: ConversationPlace): Promise<ConversationRow> {
  const { rows, keys, now } = leasing;
  const found = await rows.conversations.found(place);
  if (found !== undefined) {
    return found;
  }
  const conversation: ConversationRow = { ...place, id: randomUUIDv7(), keyId: await keys.keep(aConversationKey()) };
  if (await rows.conversations.made(conversation, await now())) {
    return conversation;
  }
  await keys.forget(conversation.keyId);
  return startedBy(leasing, place);
}

function leaseTakenBy(leasing: Leasing, leaseMs: number): ChatStore['conversations']['leaseTaken'] {
  const { rows, now } = leasing;
  return async (conversation) => {
    const holder = randomUUIDv7();
    const at = await now();
    if (!(await rows.conversations.leaseTaken(conversation.id, { holder, now: at, until: at + leaseMs }))) {
      return { running: true };
    }
    return {
      leased: {
        memory: leasedMemoryOf(leasing, conversation, holder),
        released: () => rows.conversations.leaseReleased(conversation.id, holder),
      },
    };
  };
}

function linksOver({ links }: ChatRows): ChatStore['links'] {
  return {
    started: (start) => links.started(start),
    startFound: (secret) => links.startFound(secret),
    startOf: (member) => links.startOf(member),
    startEnded: (start) => links.startEnded(start),
    linked: (link) => links.linked(link),
    linkOf: (member) => links.linkOf(member),
    personForgotten: (person) => links.personForgotten(person),
  };
}

export function chatStoreOver(
  rows: ChatRows,
  keys: KeptSecrets,
  { now, leaseMs = TURN_LEASE_MS }: ChatStoreOptions,
): ChatStore {
  const leasing: Leasing = { rows, keys, now };
  return {
    arrivals: {
      claimed: async (arrival) => rows.arrivals.claimed(arrival, await now()),
      settled: (arrival) => rows.arrivals.settled(arrival),
      unsettled: () => rows.arrivals.unsettled(),
    },
    conversations: {
      found: (place) => rows.conversations.found(place),
      started: (place) => startedBy(leasing, place),
      leaseTaken: leaseTakenBy(leasing, leaseMs),
    },
    links: linksOver(rows),
    deletions: chatDeletionsOver(rows, keys),
  };
}

export async function chatStoreOpened(
  database: ChatDatabase,
  keys: KeptSecrets,
  options: Partial<ChatStoreOptions> = {},
): Promise<ChatStore> {
  return chatStoreOver(await chatRowsOpened(database), keys, { now: clockOf(database), ...options });
}
