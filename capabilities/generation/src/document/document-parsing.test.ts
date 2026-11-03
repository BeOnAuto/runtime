import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { audioSource, imageSource, sourceWith, videoSource } from '../testing/index.ts';
import { parseGenerationDocument } from './document-parsing.ts';

function issuesOf(source: string): readonly string[] {
  return Result.match(parseGenerationDocument(source), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map(({ line, pointer, detail }) => `${line} ${pointer} ${detail}`),
  });
}

const image = ['produces: image', 'model: gateway/openai/gpt-image-2'];

describe('a generation function document', () => {
  it('reads what it produces, its model, its input, its parameters, its references, its expiry and its prompt', () => {
    const document = Result.getOrThrow(parseGenerationDocument(imageSource));

    expect({
      description: document.description,
      produces: document.produces,
      model: document.model,
      input: document.input.schema?.document['required'],
      parameters: document.parameters,
      references: document.references,
      expiresMs: document.expiresMs,
      prompt: document.prompt.text,
    }).toEqual({
      description: 'A picture of the product for its listing',
      produces: 'image',
      model: 'gateway/openai/gpt-image-2',
      input: ['product'],
      parameters: { size: '1024x1024', quality: 'high' },
      references: [],
      expiresMs: 30 * 86_400_000,
      prompt: 'A studio photograph of {{ input.product }} on a white table.',
    });
  });

  it('reads audio and video, and leaves out what the document does not say', () => {
    const audio = Result.getOrThrow(parseGenerationDocument(audioSource));
    const video = Result.getOrThrow(parseGenerationDocument(videoSource));

    expect([audio.produces, audio.parameters, audio.expiresMs, audio.input.schema, audio.description]).toEqual([
      'audio',
      { voice: 'coral' },
      undefined,
      undefined,
      undefined,
    ]);
    expect([video.produces, video.parameters]).toEqual(['video', { size: '720x1280', duration: 8 }]);
  });
});

describe('the refusals of the front matter of a generation function document', () => {
  it('is refused for a kind it cannot produce, a model written another way, and a parameter of another kind', () => {
    expect(issuesOf(sourceWith(['produces: document', 'model: openai', 'parameters: { voice: alloy }']))).toEqual([
      '2 /produces Expected image, audio or video',
      '3 /model A model is written gateway/model, such as gateway/openai/gpt-image-2',
    ]);
    expect(issuesOf(sourceWith([...image, 'parameters:', '  voice: alloy', '  duration: 3']))).toEqual([
      '5 /parameters/voice voice is not a parameter of image, which takes size, aspect, and quality',
      '6 /parameters/duration duration is not a parameter of image, which takes size, aspect, and quality',
    ]);
    expect(
      issuesOf(sourceWith(['produces: audio', 'model: Gateway/openai/tts-1', 'parameters: { size: big }'])),
    ).toEqual([
      '3 /model A model is written gateway/model, such as gateway/openai/gpt-image-2',
      '4 /parameters/size size is not a parameter of audio, which takes voice, format, and duration',
    ]);
  });

  it('is refused for references that are no pointer or that repeat, and for an expiry it cannot keep', () => {
    expect(issuesOf(sourceWith([...image, 'references: [photo, /photo, /photo]', 'expires: P5000D']))).toEqual([
      '4 /references/0 Expected a JSON Pointer into the input, such as /photo',
      '4 /references/2 /photo is named more than once',
      '5 /expires P5000D is not a time an asset may be kept. An asset expires after a duration from one hour to 3650 days, such as P30D',
    ]);
    expect(issuesOf(sourceWith([...image, 'expires: soon']))).toEqual([
      '4 /expires soon is not an ISO 8601 duration. An asset expires after a duration from one hour to 3650 days, such as P30D',
    ]);
  });
});

describe('the refusals of the input and the prompt of a generation function document', () => {
  it('is refused for an input schema that does not compile, and for a prompt that reads what the input does not have', () => {
    expect(
      issuesOf(
        sourceWith(
          [
            ...image,
            'input:',
            '  schema: { type: object, additionalProperties: false, properties: { a: { type: nope } } }',
          ],
          'Of {{ input.b }} and {{ shop }}',
        ),
      ),
    ).toEqual([
      '5 /input/schema/properties/a/type Expected one of null, boolean, object, array, number, string, integer, or a non-empty list of them',
      '7  input.b is not a property of the input schema, which allows no others',
      '7  shop is not a variable of the prompt of a generation function, which reads input, today and now; assign it first',
    ]);
  });

  it('is refused without a prompt, with a prompt that does not parse, with unknown keys and with fields of the wrong type', () => {
    expect(issuesOf(sourceWith(image, '  '))).toEqual([
      '5  The definition has no prompt: write it after the front matter',
    ]);
    expect(issuesOf(sourceWith(image, '{% if %}'))).toEqual([expect.stringMatching(/^5 /u)]);
    expect(issuesOf(sourceWith([...image, 'colour: blue', 'references: 3'], ''))).toEqual([
      '4 /colour colour is not a key of the front matter; it takes description, produces, model, input, parameters, references, expires',
      expect.stringMatching(/^5 \/references /u),
      '7  The definition has no prompt: write it after the front matter',
    ]);
  });
});

describe('the refusals of the prompt and the shape of a generation function document', () => {
  it('is refused for a prompt of more names than a template may use', () => {
    const names = Array.from({ length: 1001 }, (_, index) => `{{ input.a${index} }}`).join(' ');

    expect(issuesOf(sourceWith(image, names))).toEqual([
      '5  A template may use at most 1000 names in its tags and outputs (variables, properties, filters and keywords); this one uses 2002',
    ]);
  });

  it('is refused without front matter', () => {
    expect(issuesOf('A lighthouse.')).toEqual([
      '1  A generation function definition starts with a line of three dashes (---) that opens its front matter of YAML',
    ]);
  });
});
