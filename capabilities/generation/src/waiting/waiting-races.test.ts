import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { generationBounds } from '../capability/generation-ports.ts';
import {
  cancelled,
  contentAnswering,
  contentPath,
  flying,
  heldAt,
  making,
  runIn,
  standingPath,
  waitingRowIn,
} from '../run-testing/waiting-runs.ts';
import { answeredInTime, filmedBytes, harnessStartsAt } from '../testing/index.ts';
import { assetIdOfTheWait } from './waited-assets.ts';

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
