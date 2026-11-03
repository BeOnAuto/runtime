import { runSettler } from '@on.auto/definitions';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { generationBounds } from '../capability/generation-ports.ts';
import { assetIdOf, runIdOf } from '../run-testing/run-outcomes.ts';
import {
  contentAnswering,
  contentPath,
  contentsAsked,
  failedWith,
  flying,
  heldAt,
  minute,
  partsOf,
  pathsAsked,
  polledBy,
  runIn,
  spent,
  standingPath,
  waitingRowIn,
} from '../run-testing/waiting-runs.ts';
import {
  alpha,
  answeredInTime,
  askedHandle,
  filmedBytes,
  harnessStartsAt,
  type GatewayAnswering,
  type GenerationHarness,
} from '../testing/index.ts';
import { generationsDue } from './generations-due.ts';
import { assetIdOfTheWait } from './waited-assets.ts';
import type { WaitingParts } from './waiting-parts.ts';

describe('a second ring while the bytes of a video are fetched', () => {
  it('asks nothing again and does not end the run at its deadline, and the video is kept once', async () => {
    const held = heldAt(
      contentPath,
      contentAnswering(() => new Response(filmedBytes, { headers: { 'content-type': 'video/mp4' } })),
    );
    const playbook = await flying(held.answering, { bounds: { ...generationBounds, waitMs: 20_000 } });

    const first = playbook.pollAt(harnessStartsAt + 5000);
    await held.asked;
    const rang = [await playbook.pollAt(harnessStartsAt + 6000), await playbook.endAt(harnessStartsAt + 21_000)];
    held.release();
    await first;

    expect(rang).toEqual([0, 0]);
    expect(contentsAsked(playbook)).toHaveLength(1);
    expect((await runIn(playbook)).status).toBe('succeeded');
    expect(await playbook.totals()).toEqual({ bytes: filmedBytes.byteLength, assets: 1 });
  });
});

function bothAskedFor(): GatewayAnswering {
  const both = Promise.withResolvers<void>();
  const asked = { content: 0 };
  return contentAnswering(async () => {
    asked.content += 1;
    if (asked.content === 2) {
      both.resolve();
    }
    await both.promise;
    return new Response(filmedBytes);
  });
}

describe('two rings that both read a video as due', () => {
  it('keep one asset of it, under the id its deferral gives, and settle the run once', async () => {
    const playbook = await flying(bothAskedFor());

    await polledBy(playbook.waiting, harnessStartsAt + 5000, 2);

    const { deferred_id: deferredId } = await waitingRowIn(playbook);
    expect(contentsAsked(playbook)).toHaveLength(2);
    expect(await playbook.totals()).toEqual({ bytes: filmedBytes.byteLength, assets: 1 });
    expect(await runIn(playbook)).toMatchObject({ status: 'succeeded', output: { id: assetIdOfTheWait(deferredId) } });
    expect(await playbook.factsOf(assetIdOfTheWait(deferredId))).toHaveLength(1);
  });
});

function refusingTheFirstSettlement(ledger: WaitingParts['ledger']): WaitingParts['ledger'] {
  const refused = { settlements: 0 };
  return {
    ...ledger,
    execute: (stream, decider, command, lineage) => {
      const settles = stream.includes('/runs/') && refused.settlements === 0;
      refused.settlements += settles ? 1 : 0;
      return settles ? Effect.die(new Error('The process stopped')) : ledger.execute(stream, decider, command, lineage);
    },
  };
}

function madeThenLost(lost: () => Response): GatewayAnswering {
  const made = contentAnswering(() => new Response(filmedBytes));
  const asked = { standings: 0 };
  return (seen) => {
    asked.standings += seen.path === standingPath ? 1 : 0;
    return seen.path === standingPath && asked.standings > 1 ? lost() : made(seen);
  };
}

describe('a ring after one that kept the video and stopped before it settled the run', () => {
  it('settles the run from the asset kept, without asking for its bytes again', async () => {
    const playbook = await flying(contentAnswering(() => new Response(filmedBytes)));
    const stopping = generationsDue(partsOf(playbook, refusingTheFirstSettlement(playbook.ledger.service)));

    const [stopped] = await Promise.allSettled([polledBy(stopping, harnessStartsAt + 5000)]);
    const between = (await runIn(playbook)).status;
    await playbook.pollAt(harnessStartsAt + 5000 + 300_000);

    expect([stopped?.status, between]).toEqual(['rejected', 'started']);
    expect(await runIn(playbook)).toMatchObject({ status: 'succeeded', record: { ...spent, duration_ms: 5000 } });
    expect(contentsAsked(playbook)).toHaveLength(1);
    expect(await playbook.totals()).toEqual({ bytes: filmedBytes.byteLength, assets: 1 });
  });

  it.each([
    { lost: 'no longer knows the video', answer: () => new Response(null, { status: 404 }) },
    { lost: 'says the video failed', answer: () => Response.json(failedWith('internal_error')) },
  ] as const)(
    'settles the run from the asset kept where the gateway then $lost, asking it nothing',
    async ({ answer }) => {
      const playbook = await flying(madeThenLost(answer));
      const stopping = generationsDue(partsOf(playbook, refusingTheFirstSettlement(playbook.ledger.service)));

      await Promise.allSettled([polledBy(stopping, harnessStartsAt + 5000)]);
      await playbook.pollAt(harnessStartsAt + 5000 + 300_000);

      expect(await runIn(playbook)).toMatchObject({ status: 'succeeded', record: { ...spent, duration_ms: 5000 } });
      expect(pathsAsked(playbook)).toEqual(['/v1/videos', standingPath, contentPath]);
    },
  );
});

function ended(playbook: GenerationHarness) {
  return Effect.runPromise(runSettler(playbook.ledger.service)({ ...alpha, id: runIdOf(1) }, { status: 'failed' }));
}

describe('a ring that meets a run that ended', () => {
  it('asks nothing of the gateway and ends nothing, whether it polls or reaches the deadline', async () => {
    const playbook = await flying();
    const polls = await Effect.runPromise(playbook.waiting.due(harnessStartsAt + 10 * minute, 10, true));
    const endings = await Effect.runPromise(playbook.waiting.due(harnessStartsAt + 10 * minute, 10, false));
    await ended(playbook);

    await Effect.runPromise(
      Effect.forEach([...polls, ...endings], (item) => item.perform(harnessStartsAt + 5000), { discard: true }),
    );

    expect(pathsAsked(playbook)).toEqual(['/v1/videos']);
    expect((await runIn(playbook)).status).toBe('failed');
  });
});

function endingAsMade(held: Readonly<{ playbook?: GenerationHarness }>): GatewayAnswering {
  const made = answeredInTime({ standings: [{ id: askedHandle, status: 'completed' }] });
  return async (seen) => {
    await Promise.all(
      seen.path === `/v1/videos/${askedHandle}` && held.playbook !== undefined ? [ended(held.playbook)] : [],
    );
    return made(seen);
  };
}

describe('a run that ends while the gateway says its video was made', () => {
  it('keeps nothing and asks for no bytes', async () => {
    const held: { playbook?: GenerationHarness } = {};
    const playbook = await flying(endingAsMade(held));
    held.playbook = playbook;

    await playbook.pollAt(harnessStartsAt + 5000);

    expect(contentsAsked(playbook)).toEqual([]);
    expect(await playbook.totals()).toEqual({ bytes: 0, assets: 0 });
    expect((await runIn(playbook)).status).toBe('failed');
  });
});

describe('a gateway the runtime is no longer given', () => {
  it('ends the run unavailable, naming the gateways it is given, as a run would be refused', async () => {
    const playbook = await flying();

    await polledBy(generationsDue({ ...partsOf(playbook), gateways: [] }), harnessStartsAt + 5000);

    expect(await runIn(playbook)).toMatchObject({
      rejection: {
        reason: 'unavailable',
        kind: 'model_not_offered',
        detail: 'There is no model gateway named gateway: this runtime is given no model gateway',
      },
      record: spent,
    });
  });
});

const expiringPicture = [
  '---',
  'produces: image',
  'model: gateway/openai/gpt-image-2',
  'expires: PT1H',
  '---',
  'A lighthouse',
];

describe('an asset that expires while a video is waited for', () => {
  it('is expired and its content removed, and the video is kept after it', async () => {
    const playbook = await flying(answeredInTime(), { bounds: { ...generationBounds, waitMs: 3 * 3_600_000 } });
    await playbook.define('picture', expiringPicture.join('\n'));
    await playbook.run('picture', {}, runIdOf(2));
    const later = harnessStartsAt + 2 * 3_600_000;

    await playbook.expireAt(later);
    await playbook.pollAt(later);
    await playbook.pollAt(later + 60_000);

    expect((await playbook.factsOf(assetIdOf(1))).map(({ type }) => type)).toEqual([
      'asset_kept',
      'asset_expired',
      'asset_content_removed',
    ]);
    expect((await runIn(playbook)).status).toBe('succeeded');
    expect(await playbook.totals()).toEqual({ bytes: filmedBytes.byteLength, assets: 1 });
  });
});
