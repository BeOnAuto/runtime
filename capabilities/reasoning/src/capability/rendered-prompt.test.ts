import { InvalidInput } from '@on.auto/operations';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { documentOf } from '../testing/definition-documents.ts';
import { reasoningWith } from '../testing/reasoning-runs.ts';

const model = 'model: openai/gpt-5';

function rejected(detail: string, issue: string, pointer = '') {
  return Exit.fail(new InvalidInput({ detail, issues: [{ pointer, detail: issue }] }));
}

describe('a prompt that cannot be rendered from the input', () => {
  it('names the field the template reads and the input does not have', async () => {
    const { running, requests } = reasoningWith();

    expect(await running(documentOf(model, 'Dear {{ input.customer["first/name"] }},'), { customer: {} })).toEqual(
      rejected(
        'The template reads input.customer.first/name on line 4, which the input does not have',
        'Line 4: the template reads input.customer.first/name, which this input does not have',
        '/customer/first~1name',
      ),
    );
    expect(requests()).toEqual([]);
  });

  it('points at the input as a whole when the missing name is not a field of it', async () => {
    const { running } = reasoningWith();

    expect(
      await running(documentOf(model, '{% for item in input.items %}{{ item.name }}{% endfor %}'), { items: [{}] }),
    ).toEqual(
      rejected(
        'The template reads item.name on line 4, which the input does not have',
        'Line 4: the template reads item.name, which this input does not have',
      ),
    );
  });
});

describe('a prompt the input makes unusable', () => {
  it('is rejected when a filter rejects a value of the input', async () => {
    const { running } = reasoningWith();

    expect(await running(documentOf(model, 'Revenue: {{ input.revenue | money }}'), { revenue: 'lots' })).toEqual(
      rejected(
        'The template cannot be rendered with this input',
        'Line 4: money takes a number, or text that is a decimal number',
      ),
    );
  });

  it('is rejected when it would be longer than a prompt may be', async () => {
    const { running } = reasoningWith();

    expect(
      await running(documentOf(model, '{% for i in (1..3) %}{{ input.text }}{% endfor %}'), {
        text: 'x'.repeat(70_000),
      }),
    ).toEqual(
      rejected(
        'With this input the message of the prompt would be longer than the template may render',
        'Line 4: the message grows past 200000 characters here',
      ),
    );
  });

  it('is rejected when the render takes more than it may', async () => {
    const { running } = reasoningWith();

    expect(
      await running(documentOf(model, 'Count {% for i in (1..input.count) %}{% endfor %}'), { count: 6_000_000 }),
    ).toEqual(
      rejected(
        'Rendering the template with this input takes more memory than a render may',
        'Line 4: the render stopped here',
      ),
    );
  });
});

describe('a prompt without a message', () => {
  it('is rejected when the message it renders is empty', async () => {
    const { running } = reasoningWith();

    expect(await running(documentOf(model, '{{ input.text }}'), { text: '  ' })).toEqual(
      rejected(
        'With this input the template renders an empty message',
        'The message the template renders from this input is empty',
      ),
    );
  });
});
