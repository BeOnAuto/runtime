import { recordedRunIn } from '@on.auto/definitions';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { generationBounds } from '../capability/generation-ports.ts';
import { day, numberedHarness, ran, refusalOf, runIdOf } from '../run-testing/run-outcomes.ts';
import {
  alpha,
  answeredInTime,
  answeredWith,
  askedHandle,
  costHeader,
  harnessStartsAt,
  onePixelPng,
  sourceWith,
  videoSource,
  type GatewayAnswering,
} from '../testing/index.ts';

const StartedSchema = Schema.Struct({
  status: Schema.Literal('succeeded'),
  output: Schema.Struct({ status: Schema.Literal('started'), record: Schema.Unknown }),
});

const startedOf = Schema.decodeUnknownSync(StartedSchema);

const minute = 60_000;

function recordedOf(playbook: ReturnType<typeof numberedHarness>, index: number) {
  return Effect.runPromise(recordedRunIn(playbook.ledger.service, { ...alpha, id: runIdOf(index) }));
}

describe('a run of a generation function that produces video', () => {
  it('asks the gateway to make the video, with the seconds it asks for, and waits for it, keeping nothing yet', async () => {
    const playbook = numberedHarness({ answering: answeredInTime() });
    await playbook.define('flight', videoSource);

    const outcome = await ran(playbook, 'flight', {});

    expect(startedOf(outcome).output.record).toEqual({
      kind: 'video',
      model: 'gateway/example/short-film',
      prompt: 'A drone flight over the warehouse.',
      parameters: { size: '720x1280', duration: 8 },
      references: [],
      cost_usd: 0.8,
      own_key: true,
      handle: askedHandle,
      kept_for_ms: 90 * day,
      asked_at: new Date(harnessStartsAt).toISOString(),
      waits_until: new Date(harnessStartsAt + 10 * minute).toISOString(),
    });
    expect(playbook.gateway.asked().map(({ path, body }) => ({ path, body }))).toEqual([
      {
        path: '/v1/videos',
        body: {
          model: 'example/short-film',
          prompt: 'A drone flight over the warehouse.',
          seconds: '8',
          size: '720x1280',
        },
      },
    ]);
    expect(await playbook.totals()).toEqual({ bytes: 0, assets: 0 });
    expect((await recordedOf(playbook, 1))?.awaitsSettlement).toBe(true);
  });
});

describe('a run of a generation function that produces video and names no seconds', () => {
  it('asks for the fewest seconds the model makes where the document names none, and waits as long as the runtime is told', async () => {
    const playbook = numberedHarness({
      answering: answeredInTime({ cost: '' }),
      bounds: { ...generationBounds, waitMs: 2 * minute },
    });
    await playbook.define(
      'flight',
      sourceWith(['produces: video', 'model: gateway/example/short-film', 'expires: P1D']),
    );

    const { record } = startedOf(await ran(playbook, 'flight', {})).output;

    expect(playbook.gateway.asked()[0]?.body).toEqual({
      model: 'example/short-film',
      prompt: 'A lighthouse at dawn.',
      seconds: '4',
    });
    expect(record).toMatchObject({
      parameters: { duration: 4 },
      kept_for_ms: day,
      waits_until: new Date(harnessStartsAt + 2 * minute).toISOString(),
    });
    expect(record).not.toHaveProperty('cost_usd');
  });
});

const failedAtOnce: GatewayAnswering = () =>
  Response.json(
    { id: askedHandle, status: 'failed', error: { code: 'video_generation_failed', message: 'no' } },
    { headers: { [costHeader]: '0.8' } },
  );

const answeredNothing: GatewayAnswering = () =>
  Response.json({ object: 'video' }, { headers: { [costHeader]: '0.8' } });

describe('a video the gateway does not take', () => {
  it('is refused as the gateway refuses an image, keeping nothing and waiting for nothing', async () => {
    const moderated = numberedHarness({
      answering: answeredWith(400, { error: { code: 'moderation_blocked', message: 'refused' } }),
    });
    await moderated.define('flight', videoSource);

    expect(refusalOf(await ran(moderated, 'flight', {}))).toMatchObject({
      reason: 'conflict',
      kind: 'blocked_by_moderation',
    });
    expect((await recordedOf(moderated, 1))?.awaitsSettlement).toBe(false);
  });
});

describe('a video the gateway fails at once', () => {
  it('is unavailable where the gateway answers that it failed at once, or answers no id of the video, recording what it cost', async () => {
    const failed = numberedHarness({ answering: failedAtOnce });
    const unreadable = numberedHarness({ answering: answeredNothing });
    await failed.define('flight', videoSource);
    await unreadable.define('flight', videoSource);

    expect([refusalOf(await ran(failed, 'flight', {})), refusalOf(await ran(unreadable, 'flight', {}))]).toEqual([
      {
        reason: 'unavailable',
        kind: undefined,
        detail:
          'The provider behind the gateway gateway could not make the video, with the error code video_generation_failed; try again',
      },
      {
        reason: 'unavailable',
        kind: undefined,
        detail: 'The answer of the gateway gateway held no id of the video it was asked for; try again',
      },
    ]);
    expect((await recordedOf(failed, 1))?.run.record).toEqual({
      model: 'gateway/example/short-film',
      own_key: true,
      cost_usd: 0.8,
    });
  });

  it('is refused before the gateway is asked once the playbook keeps all it may', async () => {
    const full = numberedHarness({
      answering: answeredInTime(),
      bounds: { ...generationBounds, mostPlaybookBytes: onePixelPng.byteLength },
    });
    await full.define('picture', sourceWith(['produces: image', 'model: gateway/openai/gpt-image-2']));
    await full.define('flight', videoSource);
    await ran(full, 'picture', {}, 1);

    expect(refusalOf(await ran(full, 'flight', {}, 2))).toMatchObject({ reason: 'conflict', kind: 'oversized' });
    expect(full.gateway.asked().map(({ path }) => path)).toEqual(['/v1/images/generations']);
  });
});
