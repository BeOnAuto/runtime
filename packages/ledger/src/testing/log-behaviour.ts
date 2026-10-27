import { messageIdOf } from '@on.auto/operations';
import { Effect, ManagedRuntime } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { LedgerStore, RecordedPoint } from '../event-store.ts';
import { LedgerLog, samePoint, type LoggedEvent } from '../log/ledger-log.ts';
import { stamped } from './happenings.ts';
import { aStore, type LedgerEntry } from './ledger-entry.ts';

const alpha = 'playbook/acme/alpha/runs/one';

const beta = 'playbook/acme/beta/runs/two';

const connections = 'org/acme/connections';

function counted(from: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({ type: 'counted', data: { n: from + index } }));
}

function placeOf({ id, stream, version, type }: LoggedEvent) {
  return { id, stream, version, type };
}

function lastPointOf(events: readonly LoggedEvent[]): RecordedPoint | undefined {
  return events.map(({ point }) => point).at(-1);
}

function beyond(point: RecordedPoint): RecordedPoint {
  return [...point.slice(0, -1), String(Number(point.at(-1)) + 100)];
}

async function fourAppends(store: LedgerStore): Promise<void> {
  await store.append(alpha, counted(1, 2), { expectedVersion: 0, context: stamped });
  await store.append(beta, counted(3, 1), { expectedVersion: 0, context: stamped });
  await store.append(connections, counted(4, 1), { expectedVersion: 0, context: stamped });
  await store.append(alpha, counted(5, 1), { expectedVersion: 2, context: stamped });
}

function readingInOrder(entry: LedgerEntry): void {
  it('has no head and nothing in it while nothing was appended', async () => {
    const { log } = await aStore(entry);

    expect(await log.head()).toBeUndefined();
    expect(await log.after(undefined, 10)).toEqual({ events: [], through: undefined, more: false });
  });

  it('gives every event of every stream in the order they were appended, with its id, stream, version and point', async () => {
    const store = await aStore(entry);
    await fourAppends(store);

    const { events, through, more } = await store.log.after(undefined, 10);
    expect(events.map((event) => placeOf(event))).toEqual([
      { id: messageIdOf(alpha, 1), stream: alpha, version: 1, type: 'counted' },
      { id: messageIdOf(alpha, 2), stream: alpha, version: 2, type: 'counted' },
      { id: messageIdOf(beta, 1), stream: beta, version: 1, type: 'counted' },
      { id: messageIdOf(connections, 1), stream: connections, version: 1, type: 'counted' },
      { id: messageIdOf(alpha, 3), stream: alpha, version: 3, type: 'counted' },
    ]);
    expect([more, through, await store.log.head()]).toEqual([false, lastPointOf(events), lastPointOf(events)]);
  });
}

function readingInPages(entry: LedgerEntry): void {
  it('pages after a point, at most as many as asked, saying when more follow', async () => {
    const store = await aStore(entry);
    await store.append(alpha, counted(1, 5), { expectedVersion: 0, context: stamped });

    const first = await store.log.after(undefined, 2);
    const second = await store.log.after(first.through, 2);
    const last = await store.log.after(second.through, 2);

    expect([first, second, last].map(({ events }) => events.map(({ version }) => version))).toEqual([
      [1, 2],
      [3, 4],
      [5],
    ]);
    expect([first.more, second.more, last.more]).toEqual([true, true, false]);
    expect(await store.log.after(last.through, 2)).toEqual({ events: [], through: last.through, more: false });
  });
}

function readingAPoint(entry: LedgerEntry): void {
  it('finds the event at a point, and nothing at a point where none stands', async () => {
    const store = await aStore(entry);
    await store.append(alpha, counted(1, 3), { expectedVersion: 0, context: stamped });
    const { events } = await store.log.after(undefined, 10);

    expect(await Promise.all(events.map(({ point }) => store.log.at(point)))).toEqual(events);
    expect(await Promise.all(events.map(({ point }) => store.log.at(beyond(point))))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect([samePoint(['7'], ['7']), samePoint(['7'], ['8']), samePoint(['7', '1'], ['7'])]).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('is a service of the ledger’s layer', async () => {
    const runtime = ManagedRuntime.make(entry.ledgerOn(await entry.aDatabase()));
    onTestFinished(() => runtime.dispose());

    const head = Effect.flatMap(Effect.service(LedgerLog), (log) => Effect.promise(() => log.head()));
    expect(await runtime.runPromise(head)).toBeUndefined();
  });
}

export function logBehaviour(entry: LedgerEntry): void {
  describe('the log of a ledger', () => {
    readingInOrder(entry);
    readingInPages(entry);
    readingAPoint(entry);
  });
}
