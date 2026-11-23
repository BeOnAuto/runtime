import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ledgerLayer } from '@on.auto/ledger/sqlite';
import { Ledger, type KeptProjection } from '@on.auto/operations';
import { Effect, ManagedRuntime } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import {
  eventSubscriptionDecider,
  eventSubscriptionReadDecider,
  eventSubscriptionReadStreamOf,
  eventSubscriptionStreamOf,
  type EventSubscriptionCommand,
} from './subscription-facts.ts';
import { subscriptionRecordsOf } from './subscription-records.ts';
import { eventSubscriptions, eventSubscriptionsName } from './subscription-rows.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const chat = { connection: 'chat', topic: 'C0123' };

const repository = { connection: 'tracker', topic: 'acme/site' };

const declared = 'a'.repeat(64);

const madeThroughAWebhook = { type: 'webhook', id: 'subscription-1', secretId: 'secret-1', declared } as const;

const lobby = { connection: 'boards', topic: 'lobby' };

const madeByChecking = { type: 'polling', declared, since: '2026-11-18T08:00:00.000Z' } as const;

const history: readonly EventSubscriptionCommand[] = [
  { kind: 'failed', key: chat, failed: { kind: 'unreachable', because: 'timed_out' }, at: '2026-11-18T09:00:00.000Z' },
  { kind: 'made', key: chat, made: madeThroughAWebhook, at: '2026-11-18T09:01:00.000Z' },
  { kind: 'made', key: repository, made: { type: 'queue', id: 'q-1', declared }, at: '2026-11-18T09:02:00.000Z' },
  {
    kind: 'failed',
    key: repository,
    failed: { kind: 'tool_error', because: 'tool_error', attempted: { declared } },
    at: '2026-11-18T09:03:00.000Z',
  },
  { kind: 'removed', key: chat, at: '2026-11-18T09:04:00.000Z' },
  { kind: 'made', key: chat, made: madeThroughAWebhook, at: '2026-11-18T09:05:00.000Z' },
  { kind: 'removed', key: repository, at: '2026-11-18T09:06:00.000Z' },
  { kind: 'made', key: lobby, made: madeByChecking, at: '2026-11-18T09:07:00.000Z' },
];

function aDatabase(): string {
  const folder = mkdtempSync(join(tmpdir(), 'event-subscriptions-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  return join(folder, 'ledger.sqlite');
}

async function onLedger<A>(
  fileName: string,
  projections: readonly KeptProjection[],
  use: (ledger: Ledger['Service']) => Effect.Effect<A, unknown>,
): Promise<A> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName, projections }));
  try {
    return await runtime.runPromise(Effect.flatMap(Effect.service(Ledger), use));
  } finally {
    await runtime.dispose();
  }
}

function executed(ledger: Ledger['Service'], commands: readonly EventSubscriptionCommand[]) {
  return Effect.forEach(commands, (command) =>
    ledger.execute(eventSubscriptionStreamOf(alpha, command.key), eventSubscriptionDecider, command),
  );
}

function rowsOf(ledger: Ledger['Service']) {
  return ledger.readProjectedRows(eventSubscriptionsName, alpha, { where: [], orderBy: [], order: 'asc', limit: 10 });
}

async function filledFrom(told: readonly EventSubscriptionCommand[]) {
  const filled = aDatabase();
  await onLedger(filled, [], (ledger) => executed(ledger, told));
  return filled;
}

describe('the table of the subscriptions, rebuilt from its facts', () => {
  it.each([...history.keys()])(
    'holds what it held as each fact was appended, the history cut after fact %i',
    async (cut) => {
      const told = history.slice(0, cut + 1);
      const kept = await onLedger(aDatabase(), [eventSubscriptions], (ledger) =>
        Effect.andThen(executed(ledger, told), rowsOf(ledger)),
      );

      expect(await onLedger(await filledFrom(told), [eventSubscriptions], rowsOf)).toEqual(kept);
    },
  );

  it('starts the positions a reader moved at none, as no fact stands for them', async () => {
    const inline = aDatabase();
    const told = history.slice(0, 3);
    const moved = { failures: 0, lapsesAt: 1_800_000, dueAt: 900_000 };
    const kept = await onLedger(inline, [eventSubscriptions], (ledger) =>
      Effect.andThen(
        Effect.andThen(executed(ledger, told), subscriptionRecordsOf(ledger).moved(alpha, chat, moved)),
        subscriptionRecordsOf(ledger).read(alpha),
      ),
    );
    const rebuilt = await onLedger(await filledFrom(told), [eventSubscriptions], (ledger) =>
      subscriptionRecordsOf(ledger).read(alpha),
    );

    expect(kept).toContainEqual({ ...chat, made: madeThroughAWebhook, positions: moved });
    expect(rebuilt).toContainEqual({ ...chat, made: madeThroughAWebhook });
  });
});

describe('the table of the subscriptions a check keeps, rebuilt from its facts', () => {
  const later = '2026-11-18T09:30:00.000Z';
  const walking = { since: later, pageToken: '{"page_token":"4"}', positions: { failures: 0, dueAt: 900_000 } };
  const told: readonly EventSubscriptionCommand[] = [
    { kind: 'made', key: lobby, made: madeByChecking, at: '2026-11-18T09:00:00.000Z' },
  ];

  function readTo(ledger: Ledger['Service'], since: string) {
    const command = { key: lobby, since, at: '2026-11-18T09:31:00.000Z' };
    return ledger.execute(eventSubscriptionReadStreamOf(alpha, lobby, since), eventSubscriptionReadDecider, command);
  }

  it('reads again from the last point a fact recorded, with no page and no positions, and no second start', async () => {
    const filled = aDatabase();
    const kept = await onLedger(filled, [eventSubscriptions], (ledger) =>
      Effect.gen(function* () {
        yield* executed(ledger, told);
        yield* readTo(ledger, later);
        yield* subscriptionRecordsOf(ledger).marked(
          alpha,
          lobby,
          { ...walking, since: '2026-11-18T09:45:00.000Z' },
          later,
        );
        return yield* subscriptionRecordsOf(ledger).read(alpha);
      }),
    );
    const factsOnly = aDatabase();
    await onLedger(factsOnly, [], (ledger) => Effect.andThen(executed(ledger, told), readTo(ledger, later)));
    const rebuilt = await onLedger(factsOnly, [eventSubscriptions], (ledger) =>
      subscriptionRecordsOf(ledger).read(alpha),
    );

    expect(kept).toEqual([
      {
        ...lobby,
        made: { ...madeByChecking, since: '2026-11-18T09:45:00.000Z' },
        positions: walking.positions,
        pageToken: walking.pageToken,
      },
    ]);
    expect(rebuilt).toEqual([{ ...lobby, made: { ...madeByChecking, since: later } }]);
  });
});
