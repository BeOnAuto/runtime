import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { generationBounds } from '../capability/generation-ports.ts';
import { runIdOf } from '../run-testing/run-outcomes.ts';
import {
  cancelled,
  cancelReason,
  contentAnswering,
  contentPath,
  flying,
  heldAt,
  making,
  pathsAsked,
  runIn,
  spent,
  standingPath,
  waitingRowIn,
} from '../run-testing/waiting-runs.ts';
import { alpha, answeredInTime, filmedBytes, generationHarness, harnessStartsAt } from '../testing/index.ts';
import { assetIdOfTheWait } from './waited-assets.ts';

describe('a run that waits for a video and is cancelled', () => {
  it('ends cancelled with the cost its request spent, closes its row, and asks the gateway nothing more', async () => {
    const playbook = await flying();

    await cancelled(playbook);
    const polled = await playbook.pollAt(harnessStartsAt + 5000);

    const run = await runIn(playbook);
    expect(run).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'cancelled', kind: 'requested', detail: cancelReason },
    });
    expect(run.record).toEqual(spent);
    expect((await waitingRowIn(playbook)).open).toBe(false);
    expect([polled, pathsAsked(playbook)]).toEqual([0, ['/v1/videos']]);
  });
});

describe('a cancelled run of a generation function that waits for nothing', () => {
  it('ends as it was asked to, with no record', () => {
    const { capability } = generationHarness();

    expect(
      capability.cancel({
        run: { ...alpha, id: runIdOf(1) },
        record: {},
        kind: 'requested',
        reason: cancelReason,
        answer: null,
        work: [],
      }),
    ).toEqual({ status: 'rejected', reason: 'cancelled', kind: 'requested', detail: cancelReason });
  });
});

const deadline = harnessStartsAt + 20_000;

describe('the deadline met while a poll of the video is in flight', () => {
  it('leaves the run to the poll, and ends it at the deadline once the poll is answered', async () => {
    const held = heldAt(standingPath, answeredInTime({ standings: [making(50)] }));
    const playbook = await flying(held.answering, { bounds: { ...generationBounds, waitMs: 20_000 } });
    const endings = await Effect.runPromise(playbook.waiting.due(deadline, 10, false));

    const polling = playbook.pollAt(harnessStartsAt + 15_000);
    await held.asked;
    await Effect.runPromise(Effect.forEach(endings, (item) => item.perform(deadline), { discard: true }));
    const during = (await runIn(playbook)).status;
    held.release();
    await polling;
    const ended = await playbook.endAt(deadline);

    expect([endings.length, during, ended]).toEqual([1, 'started', 1]);
    expect(await runIn(playbook)).toMatchObject({ status: 'rejected', rejection: { kind: 'generation_timed_out' } });
  });
});

describe('a run cancelled while the bytes of its video are fetched', () => {
  it('keeps nothing of them', async () => {
    const held = heldAt(
      contentPath,
      contentAnswering(() => new Response(filmedBytes)),
    );
    const playbook = await flying(held.answering);
    const { deferred_id: deferredId } = await waitingRowIn(playbook);

    const polling = playbook.pollAt(harnessStartsAt + 5000);
    await held.asked;
    await cancelled(playbook);
    held.release();
    await polling;

    expect((await runIn(playbook)).status).toBe('rejected');
    expect(await playbook.totals()).toEqual({ bytes: 0, assets: 0 });
    expect(await playbook.factsOf(assetIdOfTheWait(deferredId))).toEqual([]);
  });
});
