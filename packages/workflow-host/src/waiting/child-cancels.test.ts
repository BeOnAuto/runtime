import { defaultLimits } from '@on.auto/workflow-engine/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { movedClock } from '../reaction-testing/moved-clock.ts';
import { recordedWaiting } from '../waiting-testing/recorded-waiting.ts';
import { parentId, waitingParent } from '../waiting-testing/waiting-parent.ts';
import { childCancelsOn } from './child-cancels.ts';

const lineage = { causationId: 'step-1', correlationId: 'root-1' };

const child = { org: 'acme', playbook: 'alpha', runId: '0199a3c4-7d2e-7c1a-9b3f-0000000000c1' };

describe('a cancel of the run a call waits for', () => {
  it('asks for the run to be cancelled with the kind of the cancel and words that say why', async () => {
    const waiting = recordedWaiting();
    const cancel = childCancelsOn(waiting.options.cancel);

    await Effect.runPromise(cancel({ child, reason: 'deadline', lineage }));
    await Effect.runPromise(cancel({ child, reason: 'parent_ended', lineage }));

    expect(waiting.cancels()).toEqual([
      {
        run: { org: 'acme', playbook: 'alpha', id: child.runId },
        request: {
          kind: 'deadline',
          reason: 'The step that waited for this run ran out of time, so it no longer needs it',
        },
        lineage,
      },
      {
        run: { org: 'acme', playbook: 'alpha', id: child.runId },
        request: {
          kind: 'parent_ended',
          reason: 'The run that waited for this run ended first, or the branch that waited for it lost a race',
        },
        lineage,
      },
    ]);
  });
});

describe('the deadline of a call that waits for a run', () => {
  it('ends the call as a timeout and cancels the run it waited for, as past its deadline', async () => {
    const waiting = recordedWaiting();
    const clock = movedClock(Date.now());
    const { settled, callStates } = await waitingParent(child.runId, { clock, waiting: waiting.options });

    clock.moveTo(Date.now() + defaultLimits.longestCallMs + 1);
    const settlement = await settled(parentId);

    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'The function notify did not finish within 600000 ms, the most it may take, at the step ask.',
    });
    expect(waiting.cancels().map(({ run, request }) => [run, request.kind])).toEqual([
      [{ org: 'acme', playbook: 'alpha', id: child.runId }, 'deadline'],
    ]);
    expect(await callStates()).toEqual([{ state: 'cancelled', delivered: 0 }]);
  });
});
