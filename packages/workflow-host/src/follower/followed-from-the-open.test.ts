import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { waitingCallsOf } from '../calls/call-rows.ts';
import { alpha, at, recorded } from '../reaction-testing/playbook-writes.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { until } from '../testing/until.ts';
import { heldFollower } from '../waiting-testing/held-follower.ts';
import { parentId, parentRun } from '../waiting-testing/waiting-parent.ts';

const child = '0199a3c4-7d2e-7c1a-9b3f-0000000000c1';

const asking = workflow('do:\n  - ask: { call: notify, with: { to: ada } }');

const pausing = workflow('do:\n  - pause: { wait: PT1H }');

const ofTheChild = {
  by: 'playbook:alpha',
  at,
  runId: child,
  definitionType: 'workflow',
  definitionName: 'check',
  definitionVersion: 1,
  calledBy: { runId: parentId, reference: '/do/0/ask', run: 1 },
};

const ofTheRun = {
  by: 'acme-admin',
  at,
  runId: parentId,
  definitionType: 'workflow',
  definitionName: 'pause',
  definitionVersion: 1,
};

describe('the ending of a run a call waits for, appended after the host opened and before its follower first passed the playbook', () => {
  it('answers the call as the follower first passes the playbook from where the host opened, not at its deadline', async () => {
    const { database, hosted, settled, release } = await heldFollower({
      answer: () => Effect.succeed({ status: 'waiting', child }),
    });
    hosted.know(parentId);
    await Effect.runPromise(hosted.host.start(runAt(parentId), startOf(asking)));
    await until(
      () => Effect.runPromise(waitingCallsOf(database, parentRun)),
      (waiting) => waiting.length === 1,
    );
    await recorded(
      database.store,
      `${alpha}runs/${child}`,
      { type: 'run_succeeded', data: { output: 'checked', record: {} } },
      ofTheChild,
    );

    release();

    expect(await settled(parentId)).toEqual({ status: 'succeeded', output: 'checked' });
  });
});

describe('a cancel request appended after the host opened and before its follower first passed the playbook', () => {
  it('ends its run cancelled as the follower first passes the playbook from where the host opened', async () => {
    const { database, hosted, settled, release } = await heldFollower();
    hosted.know(parentId);
    await Effect.runPromise(hosted.host.start(runAt(parentId), startOf(pausing)));
    await recorded(
      database.store,
      `${alpha}runs/${parentId}`,
      { type: 'run_cancel_requested', data: { kind: 'requested', reason: 'Not needed any more' } },
      ofTheRun,
    );

    release();

    expect(await settled(parentId)).toEqual({
      status: 'rejected',
      reason: 'cancelled',
      kind: 'requested',
      detail: 'Not needed any more',
      by: 'acme-admin',
    });
  });
});
