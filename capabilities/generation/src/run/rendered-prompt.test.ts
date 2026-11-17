import { templateLimits } from '@on.auto/definitions/template';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { aPageARunReturned, assetIdOf } from '../run-testing/run-outcomes.ts';
import { alpha, generationHarness, harnessStartsAt, sourceWith } from '../testing/index.ts';

const anyWords: unknown = expect.any(String);

const RefusalSchema = Schema.Struct({
  status: Schema.Literal('rejected'),
  reason: Schema.String,
  detail: Schema.String,
  issues: Schema.Array(Schema.Struct({ pointer: Schema.String, detail: Schema.String })),
});

const decodeRefusal = Schema.decodeUnknownSync(RefusalSchema);

const image = ['produces: image', 'model: gateway/openai/gpt-image-2'];

async function refusalOf(prompt: string, input: unknown = {}) {
  const playbook = generationHarness();
  await playbook.define('picture', sourceWith(image, prompt));
  const { detail, issues } = decodeRefusal(
    await playbook.run('picture', input, '019a4f2e-5c1b-7d3a-8e6f-1a2b3c4d5e6f'),
  );
  return { detail, issues, asked: playbook.gateway.asked().length };
}

describe('the prompt a run renders', () => {
  it('is refused where it reads what the input does not have, pointing at it', async () => {
    expect(await refusalOf('A {{ input.shade.colour }} lighthouse', { shade: {} })).toEqual({
      detail: anyWords,
      issues: [
        {
          pointer: '/input/shade/colour',
          detail: anyWords,
        },
      ],
      asked: 0,
    });
    expect(
      (await refusalOf('{% for item in input.items %}{{ item.name }}{% endfor %}', { items: [{}] })).issues,
    ).toEqual([{ pointer: '/input', detail: anyWords }]);
  });

  it('is refused where it renders empty, longer than the model takes, a list or an object, or past what a render may', async () => {
    const results = [
      await refusalOf('{{ input.nothing | default: "" }}', { nothing: '' }),
      await refusalOf('{{ input.text }}', { text: 'x'.repeat(401) }),
      await refusalOf('A {{ input.parts }}', { parts: ['a', 'b'] }),
      await refusalOf('{% for i in (1..300000) %}lighthouse {% endfor %}'),
      await refusalOf('{{ input.n | money }}', { n: 'lots' }),
    ];

    expect(results).toMatchObject([
      { detail: 'With this input the prompt renders empty', asked: 0 },
      { detail: anyWords, asked: 0 },
      { detail: 'The prompt writes a list or an object where it writes text', asked: 0 },
      { detail: anyWords, asked: 0 },
      { detail: 'The prompt cannot be rendered with this input', asked: 0 },
    ]);
  });
});

describe('the characters of a prompt', () => {
  it('are counted as code points, so a character written in two units counts once', async () => {
    const playbook = generationHarness();
    await playbook.define('picture', sourceWith(image, '{{ input.text }}'));

    const within = await playbook.run('picture', { text: '😀'.repeat(400) }, '019a4f2e-5c1b-7d3a-8e6f-1a2b3c4d5e70');
    const past = await refusalOf('{{ input.text }}', { text: '😀'.repeat(401) });

    expect(within).toMatchObject({ status: 'succeeded' });
    expect(past.detail).toBe('With this input the prompt takes 401 characters, more than the 400 the model takes');
  });

  it('is refused where a render takes more memory than a render may', async () => {
    expect(
      (
        await refusalOf(
          '{% assign many = "x" | split: "" %}{% for i in (1..2000000) %}{% assign many = many | push: i %}{% endfor %}',
        )
      ).detail,
    ).toBe('Rendering the prompt with this input takes more memory than a render may');
  });
});

describe('a kept file a prompt writes as text', () => {
  const photo = {
    id: assetIdOf(4),
    media_type: 'image/png',
    bytes: 4,
    sha256: 'd'.repeat(64),
    address: null,
    address_until: null,
  };

  it('is refused at the prompt, directly or through a filter, apart from a list or an object, and the model is asked nothing', async () => {
    const direct = await refusalOf('A {{ input.photo }}', { photo });
    const filtered = await refusalOf('A {{ input.photo | upcase }}', { photo });
    const listOfFiles = await refusalOf('A {{ input.photos }}', { photos: [photo] });
    const list = await refusalOf('A {{ input.parts }}', { parts: ['a', 'b'] });

    expect(direct).toMatchObject({ issues: [{ pointer: '/input' }], asked: 0 });
    expect(filtered).toEqual(direct);
    expect(listOfFiles).toEqual(list);
    expect(direct).not.toEqual(list);
  });

  it('is written by one of its fields or as its description', async () => {
    const playbook = generationHarness();
    await playbook.define('picture', sourceWith(image, 'A {{ input.photo.media_type }}, {{ input.photo | json }}'));

    expect(await playbook.run('picture', { photo }, '019a4f2e-5c1b-7d3a-8e6f-1a2b3c4d5e72')).toMatchObject({
      status: 'succeeded',
    });
  });
});

describe('a kept text a prompt reads', () => {
  it('is refused at its place past the characters the model takes, though within those a render may hold', async () => {
    const playbook = generationHarness();
    const page = await aPageARunReturned(playbook.ledger.service, alpha, assetIdOf(3), harnessStartsAt);
    await playbook.define('picture', sourceWith(image, 'A lighthouse, as {{ input.page }} says'));
    const reference = {
      id: assetIdOf(3),
      media_type: page.mediaType,
      bytes: page.bytes,
      sha256: page.sha256,
      address: null,
      address_until: null,
    };

    const refused = decodeRefusal(
      await playbook.run('picture', { page: reference }, '019a4f2e-5c1b-7d3a-8e6f-1a2b3c4d5e71'),
    );

    expect(page.bytes).toBeLessThan(templateLimits.renderedCharacters);
    expect(refused).toMatchObject({ reason: 'invalid_input', issues: [{ pointer: '/input/page' }] });
    expect(playbook.gateway.asked()).toEqual([]);
  });
});
