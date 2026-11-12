import type { PlaybookRequest } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { linksIn } from '../journal-testing/run-links.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { quietMs } from '../testing/capabilities/resumer.ts';
import { toPlaybook, type Harness } from '../testing/harness.ts';
import { leftWithItsDocumentUnread } from '../testing/lost-document-resumes.ts';
import { acted, momentAfter, startedAndLeft } from '../testing/resumed-runs.ts';
import { drivingAShell, refusingAShell } from '../testing/shell-drives.ts';

const refusal = {
  detail: 'What the run reads could not be read for a day, so it ends',
  kind: 'content_unavailable',
} as const;

const refused = { status: 'rejected', reason: 'unavailable', kind: 'content_unavailable', detail: refusal.detail };

const alpha = { org: 'acme', playbook: 'alpha' };

const whenItsAttemptDied = momentAfter(3 * 3_600_000);

const ofTheRun = toPlaybook('acme', 'alpha')(acmeAdmin, { run_id: acted.runId });

const itsAttemptDied: PlaybookRequest = { ...ofTheRun, attemptDied: true };

async function lastFactOf({ ledger }: Harness) {
  const { records } = await Effect.runPromise(
    ledger.service.readRecorded(alpha, { kind: 'run', run: acted.runId }, { order: 'desc', limit: 1 }),
  );
  return records.map(({ type, data }) => ({ type, data }))[0];
}

async function leftUnread() {
  const left = await leftWithItsDocumentUnread();
  const { capability } = left.resuming;
  const refusing = refusingAShell([capability], capability, refusal);
  const driving = drivingAShell([capability], capability);
  return { ...left, refusing, driving };
}

describe('a started run whose next attempt cannot read the document its playbook keeps outside its facts', () => {
  it('is ended with the refusal a shell gives, its attempt said to have died, reading nothing its playbook keeps', async () => {
    const left = await leftUnread();
    const notMade = await left.call(left.driving, itsAttemptDied, whenItsAttemptDied);
    const readsBefore = left.watched.reads();

    const ended = await left.call(left.refusing, itsAttemptDied, whenItsAttemptDied);

    expect(notMade).toMatchObject({ status: 'rejected', reason: 'unavailable', kind: 'content_unavailable' });
    expect(ended).toMatchObject(refused);
    expect(left.watched.reads()).toBe(readsBefore);
    expect((await linksIn(left)).map(({ type }) => type)).toEqual(['run_started', 'run_rejected']);
    expect(await lastFactOf(left)).toEqual({
      type: 'run_rejected',
      data: { rejection: { reason: 'unavailable', detail: refusal.detail, kind: 'content_unavailable' } },
    });
  });

  it('is ended as cancelled once a cancel was asked, as its next attempt would end it', async () => {
    const left = await leftUnread();
    await left.cancelled();

    expect(await left.call(left.refusing, ofTheRun, whenItsAttemptDied)).toMatchObject({
      status: 'rejected',
      reason: 'cancelled',
      kind: 'requested',
    });
    expect((await linksIn(left)).map(({ type }) => type)).toEqual([
      'run_started',
      'run_cancel_requested',
      'run_rejected',
    ]);
  });

  it('is refused as still running, recording nothing, where the request does not say its attempt died', async () => {
    const left = await leftUnread();

    expect(await left.call(left.refusing, ofTheRun, whenItsAttemptDied)).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'taken',
    });
    expect((await linksIn(left)).map(({ type }) => type)).toEqual(['run_started']);
  });
});

describe('a run with no attempt for a shell to refuse', () => {
  it('answers a run that has ended as it stands, recording nothing more', async () => {
    const started = await startedAndLeft();
    const { capability } = started.resuming;
    await started.running(momentAfter(quietMs + 1));
    const ended = await linksIn(started);

    expect(
      await started.call(refusingAShell([capability], capability, refusal), itsAttemptDied, momentAfter(quietMs + 2)),
    ).toMatchObject({ status: 'succeeded', output: { status: 'succeeded' } });
    expect(await linksIn(started)).toEqual(ended);
  });

  it('is not found for an id no run has', async () => {
    const started = await startedAndLeft();
    const { capability } = started.resuming;
    const unknown = toPlaybook('acme', 'alpha')(acmeAdmin, { run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8bff' });

    expect(
      await started.call(refusingAShell([capability], capability, refusal), unknown, momentAfter(quietMs + 1)),
    ).toMatchObject({ status: 'rejected', reason: 'not_found' });
  });
});
