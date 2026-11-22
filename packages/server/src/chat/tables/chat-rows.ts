import type { Author } from '@on.auto/chat';

export interface ArrivalKey {
  readonly connection: string;
  readonly account: string;
  readonly conversation: string;
  readonly message: string;
}

export interface Arrival extends ArrivalKey {
  readonly kind: string;
}

export type ArrivalsSelected =
  | { readonly connection: string }
  | { readonly account: string; readonly conversation: string };

export interface ArrivalRows {
  readonly claimed: (arrival: Arrival, at: number) => Promise<boolean>;
  readonly settled: (arrival: ArrivalKey) => Promise<void>;
  readonly unsettled: () => Promise<readonly Arrival[]>;
  readonly deleted: (selected: ArrivalsSelected) => Promise<boolean>;
}

export interface ConversationPlace {
  readonly connection: string;
  readonly account: string;
  readonly conversation: string;
  readonly thread: string | undefined;
}

export interface ConversationRow extends ConversationPlace {
  readonly id: string;
  readonly keyId: string;
}

export interface KeyedConversation {
  readonly id: string;
  readonly keyId: string;
}

export interface WrittenIn extends KeyedConversation {
  readonly senders: readonly string[];
}

export type ConversationsSelected =
  | { readonly connection: string }
  | { readonly account: string; readonly conversation: string; readonly thread?: string | undefined };

interface Lease {
  readonly holder: string;
  readonly now: number;
  readonly until: number;
}

export interface ConversationRows {
  readonly found: (place: ConversationPlace) => Promise<ConversationRow | undefined>;
  readonly made: (row: ConversationRow, at: number) => Promise<boolean>;
  readonly leaseTaken: (id: string, lease: Lease) => Promise<boolean>;
  readonly leaseReleased: (id: string, holder: string) => Promise<void>;
  readonly selected: (selected: ConversationsSelected) => Promise<readonly KeyedConversation[]>;
  readonly writtenIn: (sender: MemberOfAnAccount) => Promise<readonly WrittenIn[]>;
  readonly deleted: (ids: readonly string[]) => Promise<void>;
}

export interface SealedRow {
  readonly sequence: number;
  readonly author: Author;
  readonly sender: string | undefined;
  readonly sealed: string;
}

export interface MessageRows {
  readonly newest: (conversation: string, most: number) => Promise<readonly SealedRow[]>;
  readonly last: (conversation: string) => Promise<number>;
  readonly appended: (
    conversation: string,
    holder: string,
    rows: readonly [SealedRow, ...SealedRow[]],
    at: number,
  ) => Promise<boolean>;
  readonly senderDeleted: (sender: MemberOfAnAccount) => Promise<void>;
}

export interface MemberOfAnAccount {
  readonly account: string;
  readonly member: string;
}

export interface LinkStart extends MemberOfAnAccount {
  readonly secret: string;
  readonly person?: string;
}

export interface AccountLink extends MemberOfAnAccount {
  readonly person: string;
  readonly linkedAt: number;
}

export type LinksSelected = { readonly account: string } | MemberOfAnAccount | { readonly person: string };

export interface LinkRows {
  readonly started: (start: LinkStart) => Promise<void>;
  readonly startFound: (secret: string) => Promise<LinkStart | undefined>;
  readonly startOf: (member: MemberOfAnAccount) => Promise<LinkStart | undefined>;
  readonly startEnded: (start: LinkStart) => Promise<boolean>;
  readonly linked: (link: AccountLink) => Promise<void>;
  readonly linkOf: (member: MemberOfAnAccount) => Promise<AccountLink | undefined>;
  readonly personForgotten: (person: string) => Promise<void>;
  readonly linksDeleted: (selected: LinksSelected) => Promise<boolean>;
  readonly startsDeleted: (selected: LinksSelected) => Promise<boolean>;
}

export interface ChatRows {
  readonly arrivals: ArrivalRows;
  readonly conversations: ConversationRows;
  readonly messages: MessageRows;
  readonly links: LinkRows;
}
