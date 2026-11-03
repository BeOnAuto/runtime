import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { generationLayoutSteps } from '../index.ts';
import { generationHarness, imageSource } from '../testing/index.ts';
import { longestGenerationMs } from './generation-function.ts';
import { generationBounds } from './generation-ports.ts';
import { describeOutput } from './generation-words.ts';

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
      longestAnyRunMs: longestGenerationMs,
      streams: ['assets'],
      onRuns: [],
    });
    expect(generationHarness({ gateways: [] }).capability.mayChangeOutside).toBe(false);
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
        { pointer: '', detail: 'Line 3, /model: A model is written gateway/model, such as gateway/openai/gpt-image-1' },
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

  it('keeps 20 MiB of an image, 50 MiB of audio and 200 MiB of a video, 2 GiB a playbook and an asset 90 days, unless told otherwise', () => {
    expect(generationBounds).toEqual({
      mostBytes: { image: 20 * 1_048_576, audio: 50 * 1_048_576, video: 200 * 1_048_576 },
      mostPlaybookBytes: 2048 * 1_048_576,
      keptMs: 90 * 86_400_000,
    });
  });

  it('carries a ledger of the layout before forward with a step of its own tables', () => {
    expect(generationLayoutSteps).toEqual([{ layout: 11, statements: [] }]);
  });
});
