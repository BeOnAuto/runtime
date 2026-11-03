import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { generationLayoutSteps } from '../index.ts';
import { audioSource, generationHarness, imageSource, videoSource } from '../testing/index.ts';
import { generationBounds } from './generation-ports.ts';
import { describeOutput, waitingAccount } from './generation-words.ts';
import { longestGenerationMs } from './run-declarations.ts';

const longestWaitedMs = 240_000 + 600_000 + 240_000 + 60_000;

describe('the generation capability', () => {
  it('answers the type generation, reaches outside and, once a gateway is given, may change it, since a run asked again spends again', () => {
    const { capability } = generationHarness();

    expect({
      type: capability.type,
      title: capability.title,
      guide: capability.guide,
      noun: capability.noun,
      reachesOutside: capability.reachesOutside,
      mayChangeOutside: capability.mayChangeOutside,
      longestAnyRunMs: capability.longestAnyRunMs,
      streams: capability.facts.streams.map(({ streamKind }) => streamKind),
      onRuns: capability.facts.onRuns,
    }).toEqual({
      type: 'generation',
      title: 'Generation',
      guide: { name: 'generation-function' },
      noun: { one: 'generation function', other: 'generation functions' },
      reachesOutside: true,
      mayChangeOutside: true,
      longestAnyRunMs: longestWaitedMs,
      streams: ['assets'],
      onRuns: [],
    });
    expect(generationHarness({ gateways: [] }).capability.mayChangeOutside).toBe(false);
  });
});

describe('how long a run of the generation capability takes', () => {
  it('finishes a video later, waiting as long as the runtime waits for one, and makes an image or audio within its call', async () => {
    const { capability } = generationHarness();
    const prepared = await Promise.all(
      [videoSource, imageSource, audioSource].map((source) => Effect.runPromise(capability.prepare(source))),
    );
    const waitingLonger = generationHarness({ bounds: { ...generationBounds, waitMs: 3_600_000 }, answerMs: 1000 });

    expect(
      prepared.map(({ finishesLaterFor, longestRunMs, whenCancelled }) => ({
        later: finishesLaterFor({}),
        longestRunMs,
        whenCancelled,
      })),
    ).toEqual([
      { later: true, longestRunMs: longestWaitedMs, whenCancelled: 'finish' },
      { later: false, longestRunMs: longestGenerationMs, whenCancelled: 'finish' },
      { later: false, longestRunMs: longestGenerationMs, whenCancelled: 'finish' },
    ]);
    expect(waitingLonger.capability.longestAnyRunMs).toBe(1000 + 3_600_000 + 1000 + 60_000);
  });

  it('is left out of the directory listing', () => {
    expect(generationHarness().capability.outsideTheDirectoryListing).toBe(true);
  });
});

describe('a generation function definition as the capability reads it', () => {
  it('sums a definition up with the asset it answers and its input, and no description it does not have', async () => {
    const { capability } = generationHarness();

    const described = await Effect.runPromise(capability.prepare(imageSource));
    const plain = await Effect.runPromise(
      capability.prepare('---\nproduces: audio\nmodel: gateway/openai/tts-1\n---\nHi'),
    );

    expect([
      described.summary.details,
      described.summary.outputSchema?.['$id'],
      described.summary.inputSchema?.['type'],
    ]).toEqual([{ shape: 'asset' }, 'https://on.auto/shapes/asset', 'object']);
    expect([plain.summary.description, plain.summary.inputSchema]).toEqual([undefined, undefined]);
  });

  it('refuses a document it cannot read, saying how many problems it has', async () => {
    const { capability } = generationHarness();

    const one = await Effect.runPromise(Effect.flip(capability.prepare('A lighthouse')));
    const two = await Effect.runPromise(
      Effect.flip(capability.prepare('---\nproduces: film\nmodel: x\n---\nA lighthouse')),
    );

    expect([one.detail, two.detail, two.issues]).toEqual([
      'The generation function definition has a problem',
      'The generation function definition has 2 problems',
      [
        { pointer: '', detail: 'Line 2, /produces: Expected image, audio or video' },
        { pointer: '', detail: 'Line 3, /model: A model is written gateway/model, such as gateway/openai/gpt-image-2' },
      ],
    ]);
  });
});

describe('the words and the bounds of the generation capability', () => {
  it('describes the asset a run made in words, and an output it cannot read as one', () => {
    expect([
      describeOutput({ media_type: 'image/png', bytes: 2048 }),
      describeOutput({ media_type: 'audio/mpeg', bytes: 3_145_728 }),
      describeOutput({ media_type: 'video/mp4', bytes: 10 }),
      describeOutput({ media_type: 'text', bytes: 10 }),
      describeOutput('nothing'),
    ]).toEqual([
      'It made an image of 2 KiB, kept as an asset of the playbook.',
      'It made audio of 3 MiB, kept as an asset of the playbook.',
      'It made a video of 10 bytes, kept as an asset of the playbook.',
      'It made an asset of 10 bytes, kept as an asset of the playbook.',
      'It made an asset, which the details below describe.',
    ]);
  });

  it('keeps 20 MiB of an image, 50 MiB of audio and 200 MiB of a video, 2 GiB a playbook and an asset 90 days, and waits ten minutes for a video, unless told otherwise', () => {
    expect(generationBounds).toEqual({
      mostBytes: { image: 20 * 1_048_576, audio: 50 * 1_048_576, video: 200 * 1_048_576 },
      mostPlaybookBytes: 2048 * 1_048_576,
      keptMs: 90 * 86_400_000,
      waitMs: 600_000,
    });
  });

  it('carries a ledger of the layouts before forward with a step for each of its tables', () => {
    expect(generationLayoutSteps).toEqual([
      { layout: 11, statements: [] },
      { layout: 13, statements: [] },
    ]);
  });
});

describe('the words of a run that waits for a video', () => {
  it('says in words what a waiting run waits for and until when, and nothing of a record of no generation that waits', () => {
    const waiting = {
      kind: 'video',
      model: 'gateway/example/short-film',
      prompt: 'A drone flight',
      parameters: { size: '720x1280', duration: 8 },
      references: [],
      own_key: true,
      handle: 'video_1',
      kept_for_ms: 86_400_000,
      asked_at: '2026-11-01T10:00:00.000Z',
      waits_until: '2026-11-01T10:10:00.000Z',
    };

    expect([waitingAccount(waiting), waitingAccount({ waiting_for: 'reply' })]).toEqual([
      {
        summary: 'The run waits while the provider makes a video, until 2026-11-01T10:10:00.000Z at most.',
        data: { model: 'gateway/example/short-film', kind: 'video', waits_until: '2026-11-01T10:10:00.000Z' },
      },
      undefined,
    ]);
  });
});
