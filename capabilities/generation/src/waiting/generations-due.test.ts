import { createHash } from 'node:crypto';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { generationBounds } from '../capability/generation-ports.ts';
import { day, runIdOf } from '../run-testing/run-outcomes.ts';
import {
  flying,
  making,
  minute,
  pathsAsked,
  polledUntilTheDeadline,
  rejectionIn,
  runIn,
  spent,
  waitingRowIn,
} from '../run-testing/waiting-runs.ts';
import { answeredInTime, askedHandle, filmedBytes, harnessStartsAt } from '../testing/index.ts';
import { assetIdOfTheWait } from './waited-assets.ts';

const filmedDigest = createHash('sha256').update(filmedBytes).digest('hex');

describe('a video the provider makes in time', () => {
  it('is asked of the gateway as it is due, at a cadence its progress sets, and the run waits meanwhile', async () => {
    const playbook = await flying();

    const early = await playbook.pollAt(harnessStartsAt + 4999);
    const first = await playbook.pollAt(harnessStartsAt + 5000);
    const row = await waitingRowIn(playbook);

    expect([early, first]).toEqual([0, 1]);
    expect([row.polls, row.progress, row.next_poll_at]).toEqual([1, 40, harnessStartsAt + 10_000]);
    expect((await runIn(playbook)).status).toBe('started');
  });

  it('is fetched and kept as an asset once made, which settles the run with its reference', async () => {
    const playbook = await flying();
    await playbook.pollAt(harnessStartsAt + 5000);
    const { deferred_id: deferredId } = await waitingRowIn(playbook);

    await playbook.pollAt(harnessStartsAt + 10_000);

    expect(await runIn(playbook)).toMatchObject({
      status: 'succeeded',
      output: {
        id: assetIdOfTheWait(deferredId),
        media_type: 'video/mp4',
        bytes: filmedBytes.byteLength,
        sha256: filmedDigest,
        address: null,
        address_until: null,
      },
      record: { ...spent, duration_ms: 10_000 },
    });
    expect(pathsAsked(playbook)).toEqual([
      '/v1/videos',
      `/v1/videos/${askedHandle}`,
      `/v1/videos/${askedHandle}`,
      `/v1/videos/${askedHandle}/content`,
    ]);
    expect(await playbook.totals()).toEqual({ bytes: filmedBytes.byteLength, assets: 1 });
    expect(await waitingRowIn(playbook)).toMatchObject({ open: false, poll_due_at: null, ending_due_at: null });
  });
});

describe('the asset of a video made in time', () => {
  it('is recorded with what made it, the run that asked and until when it is kept', async () => {
    const playbook = await flying();
    await playbook.pollAt(harnessStartsAt + 5000);
    const { deferred_id: deferredId } = await waitingRowIn(playbook);
    await playbook.pollAt(harnessStartsAt + 10_000);

    expect(await playbook.factsOf(assetIdOfTheWait(deferredId))).toEqual([
      {
        type: 'asset_kept',
        data: {
          media_type: 'video/mp4',
          bytes: filmedBytes.byteLength,
          sha256: filmedDigest,
          kind: 'video',
          made_by: {
            generation: {
              model: 'gateway/example/short-film',
              prompt: 'A drone flight over the warehouse.',
              parameters: { size: '720x1280', duration: 8 },
              references: [],
              cost_usd: 0.8,
              own_key: true,
            },
          },
          expires_at: new Date(harnessStartsAt + 10_000 + 90 * day).toISOString(),
        },
        context: {
          at: new Date(harnessStartsAt + 10_000).toISOString(),
          by: 'acme-admin',
          runId: runIdOf(1),
          definitionType: 'generation',
          definitionName: 'flight',
          definitionVersion: 1,
        },
      },
    ]);
  });
});

describe('the due work of the generations a playbook waits for', () => {
  it('is due to ask the gateway in the lane that calls out, and to end the run at its deadline in the lane that does not', async () => {
    const playbook = await flying();
    const [either, calling, ending] = await Effect.runPromise(
      Effect.all([
        playbook.waiting.nextDueAt(harnessStartsAt),
        playbook.waiting.nextDueAt(harnessStartsAt, true),
        playbook.waiting.nextDueAt(harnessStartsAt, false),
      ]),
    );
    const endings = await Effect.runPromise(playbook.waiting.due(harnessStartsAt + 10 * minute, 10, false));

    expect([either, calling, ending]).toEqual([
      harnessStartsAt + 5000,
      harnessStartsAt + 5000,
      harnessStartsAt + 10 * minute,
    ]);
    expect(endings.map(({ key, callsOut }) => ({ key, callsOut }))).toEqual([
      { key: `acme/alpha/${runIdOf(1)}`, callsOut: false },
    ]);
  });

  it('is due for nothing once the run ended', async () => {
    const playbook = await flying();
    await playbook.pollAt(harnessStartsAt + 5000);
    await playbook.pollAt(harnessStartsAt + 10_000);

    expect(await Effect.runPromise(playbook.waiting.nextDueAt(harnessStartsAt))).toBeNull();
  });
});

describe('a video whose cost the gateway does not say', () => {
  it('is kept with no cost recorded, within the time the runtime waits for each answer of the gateway', async () => {
    const playbook = await flying(answeredInTime({ cost: '', standings: [{ id: askedHandle, status: 'completed' }] }), {
      answerMs: 60_000,
    });

    await playbook.pollAt(harnessStartsAt + 5000);

    expect((await runIn(playbook)).record).toEqual({
      model: 'gateway/example/short-film',
      own_key: true,
      duration_ms: 5000,
    });
  });
});

describe('a video the provider does not make before the deadline', () => {
  it('is asked of the gateway until the run has waited as long as it may, and ends the run unavailable, its cost recorded', async () => {
    const playbook = await flying(answeredInTime({ standings: [making(1)] }));

    const polls = await polledUntilTheDeadline(playbook);
    const before = await playbook.endAt(harnessStartsAt + 10 * minute - 1);
    const asked = pathsAsked(playbook).length;
    const ended = await playbook.endAt(harnessStartsAt + 10 * minute);

    expect(polls).toBeGreaterThan(9);
    expect([before, ended, pathsAsked(playbook).length]).toEqual([0, 1, asked]);
    expect(await runIn(playbook)).toMatchObject({
      status: 'rejected',
      rejection: {
        reason: 'unavailable',
        kind: 'generation_timed_out',
        detail:
          'The provider behind the gateway gateway had not made the video when the run had waited 10 minutes for it, as long as a run waits; a new run asks for it again',
      },
      record: spent,
    });
    expect(await playbook.totals()).toEqual({ bytes: 0, assets: 0 });
  });

  it('asks nothing more of the gateway at the deadline, and leaves the run to end there', async () => {
    const playbook = await flying(answeredInTime({ standings: [making(1)] }));

    expect(await playbook.pollAt(harnessStartsAt + 10 * minute)).toBe(1);

    expect(pathsAsked(playbook)).toEqual(['/v1/videos']);
    expect(await waitingRowIn(playbook)).toMatchObject({
      poll_due_at: null,
      ending_due_at: harnessStartsAt + 10 * minute,
    });
  });
});

describe('the words of a run that waited as long as it may', () => {
  it('says how many seconds it waited where the runtime waits less than a minute', async () => {
    const playbook = await flying(answeredInTime({ standings: [making(1)] }), {
      bounds: { ...generationBounds, waitMs: 20_000 },
    });

    await playbook.endAt(harnessStartsAt + 20_000);

    expect(await rejectionIn(playbook)).toContain('had waited 20 seconds for it');
  });

  it('says the minutes it waited though the clock moved on between the request and the deferral', async () => {
    const playbook = await flying(answeredInTime({ standings: [making(1)] }), { clockStepMs: 1 });

    await playbook.endAt(harnessStartsAt + 11 * minute);

    expect(await rejectionIn(playbook)).toContain('had waited 10 minutes for it');
  });
});
