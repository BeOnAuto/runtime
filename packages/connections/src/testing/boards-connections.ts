import type { Ledger } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { cardMoved, overTheBoardsSocket, providersOf } from '@on.auto/providers/testing';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';

import { eventSubscriptions } from '../subscriptions/subscription-rows.ts';
import type { EventsReceived } from '../triggers/connection-hearing.ts';
import { connectionEventsOver } from '../triggers/connection-reporting.ts';
import { archived, boardsEntryOf, boardsIdentity, bySubscriptionOfWhoMoved, placedCard } from './boards-reported.ts';
import { addedFact, registryOf, type Recorded } from './loop-registries.ts';

export const alpha = { org: 'acme', playbook: 'alpha' };

const connectedAt = '2026-11-22T08:00:00.000Z';

const ada = { id: 'person:ada', name: 'Ada' };

function boardsReading(placeName?: object) {
  const named =
    placeName === undefined ? placedCard : { ...placedCard, subject: { ...placedCard.subject, name: placeName } };
  return providersOf({
    ...boardsEntryOf([bySubscriptionOfWhoMoved, overTheBoardsSocket], boardsIdentity, [named, archived]),
    replaces: ['old-boards'],
  });
}

const boards = boardsReading();

function connectedFact(connection: string, appSecretIds: Readonly<Record<string, string>> = {}) {
  return {
    type: 'connection_connected',
    data: { connection, secret_id: `key-of-${connection}`, app_secret_ids: appSecretIds, connected_by: ada },
  } as const;
}

const identified = {
  type: 'connection_identified',
  data: { connection: 'connection-1', connected_at: connectedAt, user: { id: 'member-1', name: 'sam' } },
} as const;

const added = [
  addedFact('connection-1', 'boards', 'boards'),
  addedFact('connection-2', 'mended', 'boards'),
  addedFact('connection-3', 'by-hand', null),
  addedFact('connection-4', 'waiting', 'boards'),
  addedFact('connection-5', 'gone', 'boards'),
  addedFact('connection-6', 'old', 'old-boards'),
  addedFact('connection-7', 'tokenless', 'boards'),
  addedFact('connection-8', 'sales-boards', 'boards', { playbooks: ['sales'] }),
];

const connected = [
  connectedFact('connection-1', { app_level_token: 'app-1' }),
  connectedFact('connection-2', { app_level_token: 'app-2' }),
  connectedFact('connection-3'),
  connectedFact('connection-5'),
  connectedFact('connection-6'),
  connectedFact('connection-7'),
  identified,
  { type: 'connection_broken', data: { connection: 'connection-2', kind: 'credential_refused', reason: 'Refused' } },
  { type: 'connection_removed', data: { connection: 'connection-5' } },
] as const;

export function at<A>(effect: Effect.Effect<A>): Promise<A> {
  return Effect.runPromise(
    TestClock.setTime(Date.parse(connectedAt)).pipe(Effect.andThen(effect), Effect.provide(TestClock.layer())),
  );
}

export interface BoardsReporting {
  readonly subscriptions: Ledger['Service'];
  readonly events: ReturnType<typeof connectionEventsOver>;
}

const listened = [
  { workflow: 'on-cards', connection: 'boards', type: cardMoved.type, subject: 'board-7' },
  { workflow: 'on-mended', connection: 'mended', type: cardMoved.type },
];

export function boardNamed(connection: string, subject: string, name: string) {
  const data = { connection, connected_at: connectedAt, event_type: cardMoved.type, subject, name };
  return { type: 'connection_place_named', data } as const;
}

export function connectedAgain(connection: string) {
  return connectedFact(connection, { app_level_token: 'app-1' });
}

export interface Naming {
  readonly placeName?: object;
  readonly after?: readonly Recorded[];
}

export async function boardsReportingTo(
  received: EventsReceived,
  { placeName, after = [] }: Naming = {},
): Promise<BoardsReporting> {
  const subscriptions = memoryLedger(undefined, [eventSubscriptions]).service;
  const registry = await registryOf(['2026-11-22T07:00:00.000Z', added], [connectedAt, connected], ...after);
  const parts = { registry, providers: Effect.succeed(boardsReading(placeName)), subscriptions, received };
  return { subscriptions, events: connectionEventsOver(parts, () => Effect.succeed(listened)) };
}

export const boardsProviders = boards;
