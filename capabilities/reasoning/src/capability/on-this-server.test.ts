import { InvalidInput } from '@on.auto/operations';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { documentOf } from '../testing/definition-documents.ts';
import { answers, textResult } from '../testing/index.ts';
import { reasoningWith } from '../testing/reasoning-runs.ts';
import { onThisServer } from './on-this-server.ts';

const onlyItsOperators = 'a run reads at most 2,000,000 input tokens, which max_input_tokens may only lower';

describe('the sentence the reasoning-function guide ends with on a server', () => {
  it('names the providers a reasoning function names its model through, and says it may name tools', () => {
    expect(
      onThisServer({
        offered: { providers: ['anthropic', 'gateway'], aliases: [] },
        toolsConfigured: true,
      }),
    ).toBe(
      `On this server, a reasoning function names its model through anthropic and gateway, written anthropic/<model id> or gateway/<model id>; it may name the tools of the tool servers that search finds; ${onlyItsOperators}.`,
    );
  });

  it('names the models its operator named, with the references a wildcard among them accepts', () => {
    expect(
      onThisServer({
        offered: { providers: ['gateway'], aliases: ['house/fast', 'anthropic/*'] },
        toolsConfigured: false,
      }),
    ).toBe(
      `On this server, a reasoning function names its model through gateway, written gateway/<model id>, or one of the models its operator named: house/fast, anthropic/*, where a name that ends in * stands for any model id, so anthropic/<model id> runs; no tool server is configured, so it may name no tools; ${onlyItsOperators}.`,
    );
  });

  it('names only the models its operator named where no provider may be named directly', () => {
    expect(onThisServer({ offered: { providers: [], aliases: ['house/fast'] }, toolsConfigured: false })).toBe(
      `On this server, a reasoning function names one of the models its operator named: house/fast; no tool server is configured, so it may name no tools; ${onlyItsOperators}.`,
    );
  });

  it('says that no reasoning function can run before a model provider is configured', () => {
    expect(onThisServer({ offered: { providers: [], aliases: [] }, toolsConfigured: false })).toBe(
      `On this server, no model provider is configured yet, so a reasoning function cannot run until whoever runs the server configures one; no tool server is configured, so it may name no tools; ${onlyItsOperators}.`,
    );
  });
});

describe('the sentence while no model provider is configured', () => {
  it('says how a person adds a provider, where the server says, while there is none', () => {
    const setup = 'To add one, the person puts a key in the settings of the server.';
    const serving = (providers: readonly string[], aliases: readonly string[]) =>
      onThisServer({
        offered: { providers, aliases },
        toolsConfigured: false,
        providerSetup: setup,
      });

    expect(serving([], [])).toMatch(/may only lower\. To add one, /u);
    expect(serving(['anthropic'], [])).not.toContain(setup);
    expect(serving([], ['house/fast'])).not.toContain(setup);
  });
});

describe('the input tokens a run reads, as the sentence gives them', () => {
  it('are its operator’s number where its host gives one number for both, which a function may only lower', () => {
    expect(
      onThisServer({
        offered: { providers: ['anthropic'], aliases: [] },
        toolsConfigured: true,
        reading: { defaultInputTokens: 300_000, mostInputTokens: 300_000 },
      }),
    ).toMatch(/; a run reads at most 300,000 input tokens, which max_input_tokens may only lower\.$/u);
  });

  it('are the default and the most a function may raise them to, where its host allows more', () => {
    expect(
      onThisServer({
        offered: { providers: ['auto'], aliases: [] },
        toolsConfigured: true,
        reading: { defaultInputTokens: 500_000, mostInputTokens: 9_999_999 },
      }),
    ).toMatch(/; a run reads at most 500,000 input tokens, or its function's max_input_tokens, up to 9,999,999\.$/u);
  });
});

const withSchema = documentOf(
  [
    'model: openai/gpt-5',
    'input:',
    '  schema:',
    '    type: object',
    '    properties: {text: {type: string}, words: {type: integer, minimum: 1}, due: {type: string, format: date}}',
    '    required: [text, words]',
    '    additionalProperties: false',
    '  default: {words: 50}',
  ].join('\n'),
  'Summarize {{ input.text }} in {{ input.words }} words.',
);

describe('the input of a run', () => {
  it('is a JSON object, as its input schema takes, or is refused of the kind input_schema', async () => {
    const { running, requests } = reasoningWith();

    expect(await running(withSchema, ['text'])).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'The input of a reasoning function definition is a JSON object',
          issues: [{ pointer: '', detail: 'Expected a JSON object' }],
          kind: 'input_schema',
        }),
      ),
    );
    expect(requests()).toEqual([]);
  });

  it('takes the defaults of the definition for the fields it leaves out', async () => {
    const { running, requests } = reasoningWith(answers(textResult('Done')));
    await running(withSchema, { text: 'the report' });

    expect(requests()[0]?.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Summarize the report in 50 words.' }] },
    ]);
  });

  it('overrides the defaults with its own fields', async () => {
    const { running, requests } = reasoningWith(answers(textResult('Done')));
    await running(withSchema, { text: 'the report', words: 10 });

    expect(requests()[0]?.messages).toMatchObject([{ content: [{ text: 'Summarize the report in 10 words.' }] }]);
  });
});

describe('the input of a run that does not match the input schema', () => {
  it('is refused of the kind input_schema, with pointers to its fields, before the model is called', async () => {
    const { running, requests } = reasoningWith();

    expect(await running(withSchema, { words: 0, colour: 'red' })).toEqual(
      Exit.fail(
        new InvalidInput({
          detail:
            'The input: expected no field colour. The input: expected the field text. words: expected at least 1.',
          issues: [
            { pointer: '/colour', detail: 'The input: expected no field colour.' },
            { pointer: '/text', detail: 'The input: expected the field text.' },
            { pointer: '/words', detail: 'words: expected at least 1.' },
          ],
          kind: 'input_schema',
        }),
      ),
    );
    expect(requests()).toEqual([]);
  });
});

describe('the input of a run whose schema names a format', () => {
  it('must hold a string in the form its schema names, or the run asks no model', async () => {
    const { running, requests } = reasoningWith();
    const refusal = 'due: expected a date such as 2026-04-01.';

    expect(await running(withSchema, { text: 'the report', due: 'Friday' })).toEqual(
      Exit.fail(
        new InvalidInput({ detail: refusal, issues: [{ pointer: '/due', detail: refusal }], kind: 'input_schema' }),
      ),
    );
    expect(requests()).toEqual([]);
  });
});

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
