import type { ContentOwner } from '@on.auto/content';
import { RunEventSchema, type RecordedRunEvent, type RunEvent } from '@on.auto/definitions';
import { Ledger, playbookRowsOf, streamPrefixOfPlaybook, type Decider } from '@on.auto/operations';
import { Effect, Result, type Layer } from 'effect';
import { expect, it } from 'vitest';

import type { GenerationWait } from '../waiting/generation-wait.ts';
import { generationsWaiting, generationsWaitingName } from '../waiting/waiting-rows.ts';

export type WaitingLedgerOn = (projections: readonly (typeof generationsWaiting)[]) => Promise<Layer.Layer<Ledger>>;

const alpha = { org: 'acme', playbook: 'alpha' };

const beta = { org: 'acme', playbook: 'beta' };

const deferredAt = Date.parse('2026-11-01T10:00:00.000Z');

function waitOf(handle: string, waitsUntil: number): GenerationWait {
  return {
    kind: 'video',
    model: 'gateway/example/short-film',
    prompt: 'A drone flight',
    parameters: { duration: 4 },
    references: [],
    own_key: true,
    handle,
    kept_for_ms: 86_400_000,
    asked_at: new Date(deferredAt).toISOString(),
    waits_until: new Date(waitsUntil).toISOString(),
  };
}

const recording: Decider<null, RunEvent, RecordedRunEvent> = {
  initialState: null,
  evolve: () => null,
  decide: (event) => Result.succeed([event]),
  context: () => ({
    at: new Date(deferredAt).toISOString(),
    by: 'acme-admin',
    runId: 'run',
    definitionType: 'generation',
    definitionName: 'flight',
    definitionVersion: 1,
  }),
  eventSchema: RunEventSchema,
};

function recorded(playbook: ContentOwner, run: string, event: RunEvent) {
  return Effect.flatMap(Effect.service(Ledger), (ledger) =>
    ledger.execute(`${streamPrefixOfPlaybook(playbook)}runs/${run}`, recording, event),
  );
}

const readings = Effect.gen(function* () {
  const ledger = yield* Effect.service(Ledger);
  const through = deferredAt + 3_600_000;
  const polls = yield* ledger.readDueRows(generationsWaitingName, { column: 'poll_due_at', through, limit: 10 });
  const endings = yield* ledger.readDueRows(generationsWaitingName, { column: 'ending_due_at', through, limit: 10 });
  return {
    polls: playbookRowsOf(generationsWaitingName, polls).map(({ playbook, key }) => `${playbook}/${key}`),
    endings: playbookRowsOf(generationsWaitingName, endings).map(({ playbook, key }) => `${playbook}/${key}`),
    next: yield* ledger.nextDueOf(generationsWaitingName, 'poll_due_at', deferredAt),
  };
});

const advancing = (deferredId: string, open: boolean) =>
  Effect.flatMap(Effect.service(Ledger), (ledger) =>
    ledger.advanceRow(generationsWaitingName, alpha, 'one', {
      set: {
        polls: 1,
        progress: 40,
        next_poll_at: deferredAt + 60_000,
        poll_due_at: deferredAt + 60_000,
        ending_due_at: deferredAt + 600_000,
      },
      when: [
        { column: 'deferred_id', equals: deferredId },
        { column: 'open', equals: open },
      ],
    }),
  );

const rowOfOne = Effect.flatMap(Effect.service(Ledger), (ledger) =>
  ledger.readProjectedRows(generationsWaitingName, alpha, {
    where: [{ column: 'row_key', equals: 'one' }],
    orderBy: [],
    order: 'asc',
    limit: 1,
  }),
);

export function waitingOnStoresSuite(ledgerOn: WaitingLedgerOn): void {
  it('keeps the generations each playbook waits for, due to be asked and to end across playbooks, advanced only while the deferral that made the row stands open', async () => {
    const layer = await ledgerOn([generationsWaiting]);
    const program = Effect.gen(function* () {
      yield* recorded(alpha, 'one', {
        type: 'run_deferred',
        data: { record: waitOf('video_1', deferredAt + 600_000) },
      });
      yield* recorded(alpha, 'two', {
        type: 'run_deferred',
        data: { record: waitOf('video_2', deferredAt + 120_000) },
      });
      yield* recorded(beta, 'three', {
        type: 'run_deferred',
        data: { record: waitOf('video_3', deferredAt + 300_000) },
      });
      const before = yield* readings;
      const [made] = yield* rowOfOne;
      const deferredId = String(made?.row['deferred_id']);
      yield* advancing('another deferral', true);
      yield* advancing(deferredId, false);
      const unmoved = (yield* rowOfOne)[0]?.row['polls'];
      yield* advancing(deferredId, true);
      const advanced = (yield* rowOfOne)[0]?.row;
      yield* recorded(alpha, 'two', { type: 'run_failed', data: {} });
      return { before, unmoved, advanced, after: yield* readings };
    });

    const { before, unmoved, advanced, after } = await Effect.runPromise(Effect.provide(program, layer));

    expect(before).toEqual({
      polls: ['alpha/one', 'alpha/two', 'beta/three'],
      endings: ['alpha/two', 'beta/three', 'alpha/one'],
      next: deferredAt + 5000,
    });
    expect([unmoved, advanced]).toEqual([
      0,
      expect.objectContaining({ polls: 1, progress: 40, poll_due_at: deferredAt + 60_000, open: true }),
    ]);
    expect(after).toEqual({
      polls: ['beta/three', 'alpha/one'],
      endings: ['beta/three', 'alpha/one'],
      next: deferredAt + 5000,
    });
  });
}
