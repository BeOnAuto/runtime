import { PlaybookContext, playbookLedgerOf } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { playbookWith, replies, requests, success, toward } from '../testing/counting-playbooks.ts';
import type { Harness } from '../testing/harness.ts';
import { countingNoticeOf, countingNotices, type StartedByHand } from './counting-runs.ts';

describe('the notice of a run that counts', () => {
  it('names one goal alone, and three with commas and a last and', () => {
    expect([
      countingNoticeOf([requests]).detail,
      countingNoticeOf([requests, replies, { id: 'old-goal', statement: 'Kept no more.', success }]).detail,
    ]).toEqual([
      'This run counts toward Change requests. To try a workflow without counting, run it with test: true.',
      'This run counts toward Change requests, replies and old-goal. To try a workflow without counting, run it with test: true.',
    ]);
  });
});

function noticesFor(definitions: Harness, started: StartedByHand) {
  const alpha = { org: 'acme', playbook: 'alpha' };
  return Effect.runPromise(
    countingNotices(started).pipe(
      Effect.provideService(PlaybookContext, alpha),
      Effect.provide(playbookLedgerOf(definitions.ledger.service, alpha)),
    ),
  );
}

describe('the runs that are told they count', () => {
  it('are none called by another run, of a function, or of a workflow the playbook does not hold', async () => {
    const definitions = await playbookWith([toward('change-requests')]);
    const byHand: StartedByHand = { type: 'workflow', name: 'revise', test: false, calledByARun: false };
    const asked: readonly StartedByHand[] = [
      byHand,
      { ...byHand, calledByARun: true },
      { ...byHand, type: 'reasoning' },
      { ...byHand, name: 'missing' },
    ];

    const told = await Promise.all(asked.map((started) => noticesFor(definitions, started)));

    expect(told.map((notices) => notices.length)).toEqual([1, 0, 0, 0]);
  });
});
