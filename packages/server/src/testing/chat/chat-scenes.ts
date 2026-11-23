import type { Remembered } from '@on.auto/chat';
import { Option, Redacted } from 'effect';

import { keyedHashUnder, type KeyedHash } from '../../account-linking/link-secrets.ts';
import type { ChatConnection, ServingNow } from '../../chat/arrivals/arrival-parts.ts';
import { leaseHolders } from '../../chat/arrivals/lease-holders.ts';
import type { Knowing } from '../../chat/people/who-is-who.ts';
import type { ChatStore } from '../../chat/store/chat-store.ts';
import {
  directoryFake,
  modelsFake,
  serviceFake,
  steppedWaits,
  type ModelsFake,
  type ModelsScript,
  type ServiceFake,
  type ServiceScript,
  type SteppedWaits,
} from './chat-fakes.ts';
import { chatStoreInMemory } from './chat-store-in-memory.ts';
import { slackChatRenderingForTests } from './slack-chat-rendering.ts';

export const theHash: KeyedHash = Object.freeze(
  Option.getOrThrow(Option.fromNullishOr(keyedHashUnder(Redacted.make(new Uint8Array(32).fill(7))))),
);

export interface SceneScript {
  readonly service?: ServiceScript;
  readonly models?: ModelsScript;
  readonly model?: string | null;
  readonly roles?: readonly string[];
  readonly verified?: Readonly<Record<string, string>>;
  readonly sentAs?: boolean;
  readonly waiting?: boolean;
}

export function knowingOver(store: ChatStore, { roles = ['ada'], verified = {} }: SceneScript): Knowing {
  return {
    links: store.links,
    hashed: theHash,
    publicUrl: 'https://runtime.example.com',
    holdsARole: (person) => Promise.resolve(roles.includes(person)),
    personOfAVerifiedAddress: (address) => Promise.resolve(verified[address]),
    nameOf: (person) => Promise.resolve(`name of ${person}`),
    now: () => 1_000,
  };
}

export interface ChatScene {
  readonly store: ChatStore;
  readonly fake: ServiceFake;
  readonly models: ModelsFake;
  readonly connection: ChatConnection;
  readonly serving: ServingNow;
  readonly callers: readonly string[];
  readonly stepped: SteppedWaits;
  readonly renewalsFailed: readonly unknown[];
}

export function chatScene(script: SceneScript = {}): ChatScene {
  const { store } = chatStoreInMemory();
  const fake = serviceFake(script.service);
  const models = modelsFake(script.models);
  const stepped = steppedWaits();
  const { directory, callers } = directoryFake();
  const renewalsFailed: unknown[] = [];
  const connection: ChatConnection = {
    connection: 'connection-1',
    account: 'T1',
    service: fake.service,
    render: slackChatRenderingForTests,
    model: script.model === undefined ? 'provider/model' : script.model,
    accountName: 'Acme',
    requestSentAs: () => Promise.resolve(script.sentAs ?? false),
    requestWaitsIn: () => Promise.resolve(script.waiting ?? false),
    notShownHere: { has: () => false, add: () => {} },
  };
  const serving: ServingNow = {
    store,
    knowing: knowingOver(store, script),
    models: models.models,
    directory,
    directoryUrl: 'https://runtime.example.com/directory',
    now: () => 1_000,
    waits: stepped.waits,
    signal: new AbortController().signal,
    holders: leaseHolders(),
    renewalFailed: (cause) => {
      renewalsFailed.push(cause);
    },
  };
  return { store, fake, models, connection, serving, callers, stepped, renewalsFailed };
}

export interface Place {
  readonly connection: string;
  readonly account: string;
  readonly conversation: string;
  readonly thread: string | undefined;
}

async function leasedAt(store: ChatStore, place: Place) {
  const lease = await store.conversations.leaseTaken(await store.conversations.started(place));
  if ('running' in lease) {
    throw new Error('The conversation is leased to another turn');
  }
  return lease.leased;
}

export async function rememberedIn(store: ChatStore, place: Place, rows: readonly Remembered[]): Promise<void> {
  const leased = await leasedAt(store, place);
  await leased.memory.appended(rows);
  await leased.released();
}

export async function keptIn(store: ChatStore, place: Place): Promise<readonly (readonly [string, string])[]> {
  const leased = await leasedAt(store, place);
  const kept = await leased.memory.newest(99);
  await leased.released();
  return kept.map(({ author, text }) => [author, text] as const);
}

export async function heldAt(store: ChatStore, place: Place): Promise<void> {
  await leasedAt(store, place);
}
