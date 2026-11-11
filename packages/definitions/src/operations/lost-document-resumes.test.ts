import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { linksIn } from '../journal-testing/run-links.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { endedByAnotherOnItsLogLine, outputOfAnotherAttempt } from '../testing/ended-meanwhile.ts';
import { toPlaybook } from '../testing/harness.ts';
import { twoHoursLater } from '../testing/kept-documents.ts';
import { leftWithItsDocumentLost } from '../testing/lost-document-resumes.ts';
import { acted } from '../testing/resumed-runs.ts';
import { drivingAShell } from '../testing/shell-drives.ts';

const lostDocument = {
  status: 'rejected',
  reason: 'conflict',
  because: 'function_document_missing',
  detail:
    "The resumer definition step at version 1 cannot run: its document is missing from the playbook's content; update it",
};

describe('a started run whose document its playbook kept outside its facts and lost', () => {
  it('is ended by its next attempt, rejected with the code of a missing function, since no attempt can run it', async () => {
    const left = await leftWithItsDocumentLost();

    const answered = await left.running(true);

    expect(answered).toMatchObject(lostDocument);
    expect((await linksIn(left)).map(({ type }) => type)).toEqual(['run_started', 'run_rejected']);
  });

  it('is ended the same way by a caller who asks for it again, with no attempt of it known to have died', async () => {
    const left = await leftWithItsDocumentLost();

    expect(await left.running()).toMatchObject(lostDocument);
  });

  it('is ended by the next attempt a shell drives from its facts, as by one run_definition makes', async () => {
    const left = await leftWithItsDocumentLost();
    const drive = drivingAShell([left.resuming.capability], left.resuming.capability);

    expect(
      await left.call(drive, toPlaybook('acme', 'alpha')(acmeAdmin, { run_id: acted.runId }), twoHoursLater),
    ).toMatchObject(lostDocument);
  });

  it('is ended as cancelled once a cancel was asked, without reading its document', async () => {
    const left = await leftWithItsDocumentLost();

    await left.cancelled();

    expect(await left.running(true)).toMatchObject({ status: 'rejected', reason: 'cancelled', kind: 'requested' });
    expect((await linksIn(left)).map(({ type }) => type)).toEqual([
      'run_started',
      'run_cancel_requested',
      'run_rejected',
    ]);
  });
});

describe('a started run whose document is lost, which another attempt ended while this one recorded the loss', () => {
  it('answers what the other attempt ended it with, asked again or driven by a shell', async () => {
    const asked = await leftWithItsDocumentLost();
    const driven = await leftWithItsDocumentLost();
    const drive = drivingAShell([driven.resuming.capability], driven.resuming.capability);
    const request = toPlaybook('acme', 'alpha')(acmeAdmin, { run_id: acted.runId });

    const answers = [
      await asked.run(asked.asking(true).pipe(Effect.provide(endedByAnotherOnItsLogLine(asked))), twoHoursLater),
      await driven.run(
        driven.dispatch(drive, request).pipe(Effect.provide(endedByAnotherOnItsLogLine(driven))),
        twoHoursLater,
      ),
    ];

    expect(answers).toMatchObject([
      { status: 'succeeded', output: { status: 'succeeded', output: outputOfAnotherAttempt } },
      { status: 'succeeded', output: { next: 'answered', status: 'succeeded' } },
    ]);
  });
});
