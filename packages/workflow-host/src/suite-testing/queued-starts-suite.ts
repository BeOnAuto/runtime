import { mostPublishedEventBytes } from '@on.auto/definitions';
import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';
import { expect, it } from 'vitest';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { queuedStartsOn, type QueuedStart } from '../queued-starts/queued-starts.ts';
import type { ReactionStart } from '../reactions/reaction-options.ts';
import { refusalsOn } from '../reactions/refusals.ts';
import { mostDeferredStarts, mostStartsAMinute, startingOn } from '../reactions/start-rates.ts';
import { openedOn, type SettingsOf } from '../testing/host-files.ts';

const minute = Date.parse('2026-10-01T09:00:00.000Z');

const aMinute = 60_000;

const close = { org: 'acme', definition: '0199a3c4-7d2e-7c1a-9b3f-0000000c105e' };

const review = { org: 'acme', definition: '0199a3c4-7d2e-7c1a-9b3f-00000000beef' };

const closeKey = `definition/acme/${close.definition}/`;

const reviewKey = `definition/acme/${review.definition}/`;

const kept = 'what only the workflow reads';

const LongestRow = Schema.Struct({ longest: WholeNumber });

function eventOf(index: number) {
  return {
    id: `event-${index}`,
    source: '/ledger/eu',
    type: 'com.acme.ledger.month-closed',
    ...(index % 2 === 0 ? { subject: `month-${index}` } : {}),
    time: '2026-10-01T09:00:00Z',
  };
}

function startOf(definitionKey: string, index: number): ReactionStart {
  return {
    org: 'acme',
    playbook: 'alpha',
    definitionKey,
    workflow: 'close',
    version: 1,
    runId: `run-${index}`,
    input: [{ specversion: '1.0', ...eventOf(index), data: { kept } }],
    depth: 1,
    cause: `record-${index}`,
    trigger: { kind: 'event', reference: '/schedule/on' },
  };
}

function queuedOf(index: number, dueAt: number): QueuedStart {
  return { runId: `run-${index}`, event: eventOf(index), dueAt, attempts: 0 };
}

interface Handed {
  readonly rows: unknown[];
}

function handingBack(database: HostDatabase): { readonly database: HostDatabase; readonly handed: Handed } {
  const handed: Handed = { rows: [] };
  const read: HostDatabase['read'] = (asked) =>
    Effect.tap(database.read(asked), (rows) =>
      Effect.sync(() => {
        handed.rows.push(...rows);
      }),
    );
  return { handed, database: { ...database, read } };
}

async function startingOnA(settings: SettingsOf, time: Readonly<{ now: number }>) {
  const database = await openedOn(await settings());
  const started: string[] = [];
  const now = () => time.now;
  const starting = startingOn(
    database,
    (start) =>
      Effect.sync(() => {
        started.push(start.runId);
      }),
    refusalsOn(database, 'workflow', now),
    now,
  );
  const startsOf = (definitionKey: string, from: number, count: number) =>
    Effect.runPromise(
      Effect.forEach(
        Array.from({ length: count }, (_, index) => from + index),
        (index) => starting.start('playbook/acme/alpha/', startOf(definitionKey, index)),
        { discard: true },
      ),
    );
  return { database, started, starting, startsOf, queue: queuedStartsOn(database) };
}

async function queuedLargestInABurst(database: HostDatabase): Promise<void> {
  const before = `{"org":"acme","playbook":"alpha","definitionKey":"${closeKey}","workflow":"close","version":1,"runId":"run-1####","input":[{"specversion":"1.0","id":"event-1####","source":"/ledger/eu","type":"com.acme.ledger.month-closed","time":"2026-10-01T09:00:00Z","data":{"text":"`;
  const after = '"}}],"depth":1,"cause":"record-1####","trigger":{"kind":"event","reference":"/schedule/on"}}';
  const event = before.slice(before.indexOf('{"specversion"'));
  const filling = 'x'.repeat(mostPublishedEventBytes - event.length - '"}}'.length);
  await Effect.runPromise(
    database.write(
      statement`WITH RECURSIVE queued (at) AS (
          SELECT 0 UNION ALL SELECT at + 1 FROM queued WHERE at < ${mostDeferredStarts - 1}
        )
        INSERT INTO workflow_reaction_backlog (definition_key, run_id, start, due)
        SELECT ${closeKey}, 'run-' || (10000 + at),
          replace(${before}, '1####', CAST(10000 + at AS TEXT)) || ${filling}
            || replace(${after}, '1####', CAST(10000 + at AS TEXT)),
          CAST(${minute + aMinute} AS BIGINT)
        FROM queued`,
    ),
  );
}

function countSuite(settings: SettingsOf): void {
  it('answers how many starts of a workflow are queued and when the first is due, and none for another workflow', async () => {
    const time = { now: minute + 1000 };
    const { queue, startsOf } = await startingOnA(settings, time);

    await startsOf(closeKey, 0, mostStartsAMinute + 2);
    const queued = await Effect.runPromise(queue.queuedStartsOf(close));
    const elsewhere = await Effect.runPromise(queue.queuedStartsOf(review));

    expect([queued, elsewhere]).toEqual([
      { queued: 2, nextDueAt: minute + aMinute },
      { queued: 0, nextDueAt: null },
    ]);
  });
}

function pageSuite(settings: SettingsOf): void {
  it('pages them in the order they are taken up, each page going on after the last start it showed while starts are taken', async () => {
    const time = { now: minute + 1000 };
    const { queue, started, starting, startsOf } = await startingOnA(settings, time);
    await startsOf(closeKey, 0, mostStartsAMinute + 5);
    await startsOf(reviewKey, 5000, mostStartsAMinute + 1);
    time.now = minute + aMinute + 1000;
    await startsOf(closeKey, 1000, mostStartsAMinute - 2);

    const first = await Effect.runPromise(queue.queuedStartsPage(close, { limit: 2 }));
    await Effect.runPromise(starting.startDeferred());
    const second = await Effect.runPromise(
      queue.queuedStartsPage(close, { after: { dueAt: minute + aMinute, runId: 'run-61' }, limit: 2 }),
    );
    const third = await Effect.runPromise(
      queue.queuedStartsPage(close, { after: { dueAt: minute + 2 * aMinute, runId: 'run-63' }, limit: 2 }),
    );

    expect(first).toEqual({ starts: [queuedOf(60, minute + aMinute), queuedOf(61, minute + aMinute)], more: true });
    expect(started.filter((runId) => ['run-60', 'run-61', 'run-62'].includes(runId))).toEqual(['run-60', 'run-61']);
    expect([second, third]).toEqual([
      { starts: [queuedOf(62, minute + 2 * aMinute), queuedOf(63, minute + 2 * aMinute)], more: true },
      { starts: [queuedOf(64, minute + 2 * aMinute)], more: false },
    ]);
  });
}

function contentSuite(settings: SettingsOf): void {
  it('hands back no row of what an event carries, for a page or for the count', async () => {
    const time = { now: minute + 1000 };
    const { database, startsOf } = await startingOnA(settings, time);
    await startsOf(closeKey, 0, mostStartsAMinute + 3);
    const { database: watched, handed } = handingBack(database);
    const queue = queuedStartsOn(watched);

    const page = await Effect.runPromise(queue.queuedStartsPage(close, { limit: 20 }));
    await Effect.runPromise(queue.queuedStartsOf(close));

    expect(page.starts).toHaveLength(3);
    expect(handed.rows).toHaveLength(4);
    expect(JSON.stringify(handed.rows)).not.toContain(kept);
  });

  it('reads a page of 1,000 starts of the largest events queued in one burst, all due at once, without handing back what any event carries', async () => {
    const database = await openedOn(await settings());
    await queuedLargestInABurst(database);
    const { database: watched, handed } = handingBack(database);
    const queue = queuedStartsOn(watched);

    const [stored] = await Effect.runPromise(
      rowsOf(LongestRow, database.read(statement`SELECT max(length(start)) AS longest FROM workflow_reaction_backlog`)),
    );
    const queued = await Effect.runPromise(queue.queuedStartsOf(close));
    const page = await Effect.runPromise(
      queue.queuedStartsPage(close, { after: { dueAt: minute + aMinute, runId: 'run-10499' }, limit: 20 }),
    );

    expect(stored?.longest).toBeGreaterThan(mostPublishedEventBytes);
    expect(queued).toEqual({ queued: mostDeferredStarts, nextDueAt: minute + aMinute });
    expect([page.starts.at(0)?.runId, page.starts.at(-1)?.runId, page.more]).toEqual(['run-10500', 'run-10519', true]);
    expect(JSON.stringify(handed.rows).length).toBeLessThan(8192);
  });
}

export function queuedStartsSuite(settings: SettingsOf): void {
  countSuite(settings);
  pageSuite(settings);
  contentSuite(settings);
}
