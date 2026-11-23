import { Effect } from 'effect';

import { checkDueAt } from '../checks/check-pace.ts';
import type { LoopConnection, SubscriptionLoopPorts } from '../subscriptions/subscription-ports.ts';
import { isPolled, type Polled } from '../subscriptions/subscription-records.ts';
import {
  aListingApp,
  checkedDestinations,
  checkedNewestFirst,
  checkedOldestFirst,
  type ListingAnswering,
  type ListingApp,
  type Post,
} from './checked-apps.ts';
import { alpha, loopOver, portsOf, startedAt, type Loop, type Runtime } from './subscription-loops.ts';
import { declared } from './subscription-services.ts';

export const minute = 60_000;

export const anHour = 60 * minute;

export const lobby = { connection: 'tracker', topic: 'lobby' };

const connected = '2026-10-01T08:00:00.000Z';

export const startingNow = { ...checkedOldestFirst, read: { ...checkedOldestFirst.read, start: '{{ now }}' } };

export const newestStartingNow = { ...checkedNewestFirst, read: { ...checkedNewestFirst.read, start: '{{ now }}' } };

export function timeOf(minutes: number): string {
  return new Date(startedAt + minutes * minute).toISOString();
}

export function aPost(id: string, minutes: number): Post {
  return { id, room: 'lobby', at: timeOf(minutes), words: `post ${id}` };
}

export function polledOf(written: object): Polled {
  return declared(checkedDestinations(written).find((destination) => isPolled(destination)));
}

export function checkedThrough(written: object, connection = connected): LoopConnection {
  return {
    id: 'id-of-tracker',
    connection: 'tracker',
    connected: connection,
    destinations: checkedDestinations(written),
  };
}

export interface Checking {
  readonly written?: object;
  readonly answering?: ListingAnswering;
  readonly runtime?: Runtime;
  readonly posts?: readonly Post[];
}

export interface Checked {
  readonly app: ListingApp;
  readonly loop: Loop;
  readonly ports: SubscriptionLoopPorts;
}

export function checking({
  written = checkedOldestFirst,
  answering,
  runtime = {},
  posts = [],
}: Checking = {}): Checked {
  const app = aListingApp(answering ?? { order: polledOf(written).read.order });
  app.posted(...posts);
  const loop = loopOver([checkedThrough(written)], [lobby]);
  const ports = portsOf(loop, { receives: ['polling'], through: app.through, ...runtime });
  return { app, loop, ports };
}

export function dueAfter(at: number, written: object = checkedOldestFirst, retryAfterMs: number | null = null): number {
  return checkDueAt({ now: at, playbook: alpha }, polledOf(written), retryAfterMs);
}

export function sinceIn({ loop }: Checked): string | undefined {
  const made = loop.records.rows()[0]?.made;
  return made?.type === 'polling' ? made.since : undefined;
}

export function factTypes({ loop }: Checked): readonly string[] {
  return loop.records.facts().map(({ type }) => type);
}

export interface Counted {
  readonly ports: SubscriptionLoopPorts;
  readonly advances: () => number;
}

export function counting(ports: SubscriptionLoopPorts): Counted {
  const advanced: string[] = [];
  const { records } = ports;
  return {
    ports: {
      ...ports,
      records: {
        ...records,
        marked: (playbook, key, mark, from) =>
          Effect.andThen(
            Effect.sync(() => advanced.push('marked')),
            records.marked(playbook, key, mark, from),
          ),
        moved: (playbook, key, positions) =>
          Effect.andThen(
            Effect.sync(() => advanced.push('moved')),
            records.moved(playbook, key, positions),
          ),
      },
    },
    advances: () => advanced.length,
  };
}
