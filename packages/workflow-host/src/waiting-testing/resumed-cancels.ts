import { Conflict } from '@on.auto/operations';
import type { RunInput, Submission } from '@on.auto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { alpha, at, recorded } from '../reaction-testing/playbook-writes.ts';
import { faultyDatabase, type FaultyDatabase } from '../testing/faulty-database.ts';
import { openedOn, type SettingsOf } from '../testing/host-files.ts';
import { passedOverRow, pendingCancelRowsAfter } from '../waiting/pending-cancel-rows.ts';
import { pendingCancelsGivenOnce } from '../waiting/pending-cancels.ts';

export interface ResumedCancels {
  readonly database: FaultyDatabase;
  readonly given: () => readonly string[];
  readonly troubles: () => readonly string[];
  readonly resume: () => Promise<void>;
  readonly pending: () => Promise<readonly string[]>;
  readonly failingNoMore: () => void;
}

const cancel = { by: 'acme-admin', kind: 'requested', reason: 'Not needed any more' } as const;

const outcomes: Readonly<Record<string, Submission['outcome'] | 'conflict'>> = {
  'acme/alpha/applied': 'applied',
  'acme/alpha/ended': 'stale',
  'acme/alpha/failing': 'conflict',
  'acme/alpha/not-started': 'not_started',
  'acme/alpha/stranded': 'not_started',
};

async function pendingFor(runKeys: readonly string[], database: HostDatabase): Promise<void> {
  await Effect.runPromise(
    Effect.forEach(runKeys, (runKey) => passedOverRow(database, { runKey, cause: `${runKey}-asked`, cancel })),
  );
}

export async function resumedWith(settingsOf: SettingsOf, runKeys: readonly string[]): Promise<ResumedCancels> {
  const database = faultyDatabase(await openedOn(await settingsOf()));
  await pendingFor(runKeys, database);
  const given: string[] = [];
  const troubles: string[] = [];
  const failing = { still: true };
  const submitted = (input: RunInput) =>
    Effect.suspend(() => {
      given.push(input.runId);
      const outcome = outcomes[input.runId] ?? 'applied';
      return outcome === 'conflict' && failing.still
        ? Effect.fail(new Conflict({ detail: 'The log of the run kept changing' }))
        : Effect.succeed({ outcome: outcome === 'conflict' ? 'applied' : outcome, version: 2 });
    });
  const cancelsAsked = pendingCancelsGivenOnce({ database, submitted, now: () => 1 }, (what) =>
    Effect.sync(() => {
      troubles.push(what);
    }),
  );
  return {
    database,
    given: () => given,
    troubles: () => troubles,
    resume: () => Effect.runPromise(cancelsAsked),
    pending: async () =>
      (await Effect.runPromise(pendingCancelRowsAfter(database, '', 1000))).map(({ runKey }) => runKey),
    failingNoMore: () => {
      failing.still = false;
    },
  };
}

const ofTheRun = {
  by: 'acme-admin',
  at,
  definitionType: 'workflow',
  definitionName: 'pause',
  definitionVersion: 1,
};

const asked = { type: 'run_cancel_requested', data: { kind: 'requested', reason: 'Not needed any more' } };

const rejectedUnstarted = {
  type: 'run_rejected',
  data: { rejection: { reason: 'unavailable', detail: 'The workflow could not be started' } },
};

export function endedRunSuite(settingsOf: SettingsOf): void {
  describe('a cancel kept for a run that finished without ever reaching the host', () => {
    it('is cleared by the newest head of the run, read first, and given to no run', async () => {
      const resumed = await resumedWith(settingsOf, ['acme/alpha/finished-unstarted', 'acme/alpha/stranded']);
      await recorded(resumed.database.store, `${alpha}runs/finished-unstarted`, asked, ofTheRun);
      await recorded(resumed.database.store, `${alpha}runs/finished-unstarted`, rejectedUnstarted, ofTheRun);
      await recorded(resumed.database.store, `${alpha}runs/stranded`, asked, ofTheRun);

      await resumed.resume();

      expect(resumed.given()).toEqual(['acme/alpha/stranded']);
      expect(await resumed.pending()).toEqual(['acme/alpha/stranded']);
    });
  });
}
