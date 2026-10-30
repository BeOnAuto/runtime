import { randomUUID } from 'node:crypto';

import { dailyVisitsWith } from '@on.auto/prediction/testing';
import { expect } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/waiting/until.ts';

const day = 86_400_000;

export const dailyVisits = dailyVisitsWith(['  target: { as: count }', '  target: { of: /visits, as: sum }']);

interface PublishedVisit {
  readonly id: string;
  readonly source: string;
  readonly type: string;
  readonly time: string;
  readonly data: { readonly store: string; readonly visits: number };
}

export interface Visits {
  readonly today: number;
  readonly dayOf: (ago: number) => string;
}

export function visitsToday(): Visits {
  const today = Math.floor(Date.now() / day);
  return { today, dayOf: (ago) => new Date((today - ago) * day).toISOString().slice(0, 10) };
}

export function visitsOf(store: string, ago: number): number {
  return (store === 'north' ? 10 : 20) + (ago % 3);
}

export async function savedVisits(server: ReasoningServer, name = 'daily-visits'): Promise<void> {
  const created = await server.call('POST', `${alpha}/definitions/prediction`, { body: { name, source: dailyVisits } });
  expect(created.status).toBe(201);
}

export async function publishedVisits(
  server: ReasoningServer,
  { today }: Visits,
  daysOfEachStore: Readonly<Record<string, number>>,
): Promise<void> {
  const events: readonly PublishedVisit[] = Object.entries(daysOfEachStore).flatMap(
    ([store, days]: readonly [string, number]) =>
      Array.from({ length: days }, (_, at) => days - at).map((ago) => ({
        id: randomUUID(),
        source: '/stores',
        type: 'visit.made',
        time: new Date((today - ago) * day + 36_000_000).toISOString(),
        data: { store, visits: visitsOf(store, ago) },
      })),
  );
  const published = await Promise.all(
    events.map((event) => server.call('POST', `${alpha}/events`, { body: { event } })),
  );
  expect(published.map(({ status }) => status)).toEqual(events.map(() => 200));
  await until(async () => {
    const { body } = await server.call('GET', `${alpha}/definitions/prediction/daily-visits`);
    expect(body).toMatchObject({ standing: { dataset: { phase: 'live', events_folded: events.length } } });
  });
}
