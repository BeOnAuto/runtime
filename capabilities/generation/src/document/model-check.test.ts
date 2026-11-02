import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { catalogOf } from '../catalog/generation-catalog.ts';
import { runnableModel } from '../run/runnable-model.ts';
import { generationHarness, sourceWith, testCatalog, testEntries } from '../testing/index.ts';
import { parseGenerationDocument } from './document-parsing.ts';

const SavedSchema = Schema.Struct({
  status: Schema.String,
  issues: Schema.optionalKey(Schema.Array(Schema.Struct({ detail: Schema.String }))),
});

const decodeSaved = Schema.decodeUnknownSync(SavedSchema);

async function issuesOf(frontMatter: readonly string[], options: Parameters<typeof generationHarness>[0] = {}) {
  const saved = decodeSaved(await generationHarness(options).define('made', sourceWith(frontMatter)));
  return saved.issues?.map(({ detail }) => detail) ?? saved.status;
}

describe('the model of a generation function, checked as it is saved', () => {
  it('is one of the catalogue, a model of the kind the function produces, and not retired', async () => {
    expect([
      await issuesOf(['produces: image', 'model: gateway/openai/gpt-9-image']),
      await issuesOf(['produces: image', 'model: gateway/example/old-image']),
      await issuesOf(['produces: image', 'model: gateway/openai/gpt-4o-mini-tts']),
    ]).toEqual([
      [
        "Line 3, /model: openai/gpt-9-image is no model of the catalogue of generation models; the catalogue's models that produce image are openai/gpt-image-1 or example/square-image",
      ],
      ['Line 3, /model: example/old-image was retired on 2026-06-30; name gateway/openai/gpt-image-1 instead'],
      ['Line 2, /produces: openai/gpt-4o-mini-tts produces audio, not image'],
    ]);
  });

  it('says so where the catalogue names no model of the kind', async () => {
    const images = Result.getOrThrow(catalogOf(testEntries.filter(({ kind }) => kind === 'image')));

    expect(await issuesOf(['produces: video', 'model: gateway/openai/sora-2'], { catalog: images })).toEqual([
      'Line 3, /model: openai/sora-2 is no model of the catalogue of generation models; the catalogue names no model that produces video',
    ]);
  });
});

describe('the parameters of a generation function, checked as it is saved', () => {
  it('takes only the parameters the model takes, within its limits', async () => {
    expect([
      await issuesOf([
        'produces: image',
        'model: gateway/openai/gpt-image-1',
        'parameters: { size: 640x480, aspect: "1:1", quality: hd }',
      ]),
      await issuesOf([
        'produces: image',
        'model: gateway/example/square-image',
        'parameters: { aspect: "4:3", size: 1024x1024 }',
      ]),
      await issuesOf([
        'produces: audio',
        'model: gateway/openai/gpt-4o-mini-tts',
        'parameters: { voice: nova, format: ogg, duration: 4 }',
      ]),
      await issuesOf(['produces: audio', 'model: gateway/example/long-sound', 'parameters: { duration: 31 }']),
      await issuesOf([
        'produces: video',
        'model: gateway/openai/sora-2',
        'parameters: { duration: 2, aspect: "9:16" }',
      ]),
    ]).toEqual([
      [
        'Line 4, /parameters/size: 640x480 is not a size of openai/gpt-image-1, which takes auto, 1024x1024, 1536x1024, or 1024x1536',
        'Line 4, /parameters/aspect: openai/gpt-image-1 takes no aspect',
        'Line 4, /parameters/quality: hd is not a quality of openai/gpt-image-1, which takes auto, low, medium, or high',
      ],
      [
        'Line 4, /parameters/size: example/square-image takes no size',
        'Line 4, /parameters/aspect: 4:3 is not an aspect of example/square-image, which takes 1:1 or 16:9',
      ],
      [
        'Line 4, /parameters/voice: nova is not a voice of openai/gpt-4o-mini-tts, which takes alloy or coral',
        'Line 4, /parameters/format: ogg is not a format of openai/gpt-4o-mini-tts, which takes mp3 or wav',
        'Line 4, /parameters/duration: openai/gpt-4o-mini-tts takes no duration',
      ],
      ['Line 4, /parameters/duration: example/long-sound makes from 1 to 30 seconds, not 31'],
      [
        'Line 4, /parameters/aspect: openai/sora-2 takes no aspect',
        'Line 4, /parameters/duration: openai/sora-2 makes from 4 to 12 seconds, not 2',
      ],
    ]);
  });
});

describe('the references of a generation function, checked as it is saved', () => {
  it('takes no more references than the model takes, and none where it takes none', async () => {
    expect([
      await issuesOf(['produces: image', 'model: gateway/openai/gpt-image-1', 'references: [/a, /b, /c]']),
      await issuesOf(['produces: audio', 'model: gateway/openai/gpt-4o-mini-tts', 'references: [/a]']),
      await issuesOf([
        'produces: image',
        'model: gateway/openai/gpt-image-1',
        'references: [/a, /b]',
        'parameters: { size: auto }',
      ]),
    ]).toEqual([
      ['Line 4, /references: openai/gpt-image-1 takes at most 2 references'],
      ['Line 4, /references: openai/gpt-4o-mini-tts takes no references'],
      'succeeded',
    ]);
  });
});

describe('the model of a saved generation function, checked again as it runs', () => {
  it('is refused as a definition to update where the catalogue no longer takes it', async () => {
    const document = Result.getOrThrow(
      parseGenerationDocument(sourceWith(['produces: image', 'model: gateway/example/old-image'])),
    );

    const refusal = await Effect.runPromise(
      Effect.flip(runnableModel({ catalog: testCatalog, gateways: [] }, document)),
    );

    expect([refusal.detail, refusal.kind]).toEqual([
      'Line 3, /model: example/old-image was retired on 2026-06-30; name gateway/openai/gpt-image-1 instead; update the generation function definition',
      'unworkable',
    ]);
  });
});
