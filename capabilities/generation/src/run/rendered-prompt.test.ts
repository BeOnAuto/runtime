import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { generationHarness, sourceWith } from '../testing/index.ts';

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
      detail: 'The prompt reads input.shade.colour on line 5, which the input does not have',
      issues: [
        {
          pointer: '/input/shade/colour',
          detail: 'Line 5: the prompt reads input.shade.colour, which this input does not have',
        },
      ],
      asked: 0,
    });
    expect(
      (await refusalOf('{% for item in input.items %}{{ item.name }}{% endfor %}', { items: [{}] })).issues,
    ).toEqual([{ pointer: '/input', detail: 'Line 5: the prompt reads item.name, which this input does not have' }]);
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
      { detail: 'With this input the prompt takes 401 characters, more than the 400 the model takes', asked: 0 },
      { detail: 'The prompt writes a list or an object where it writes text', asked: 0 },
      { detail: 'Rendering the prompt with this input takes a longer prompt than a render may', asked: 0 },
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
