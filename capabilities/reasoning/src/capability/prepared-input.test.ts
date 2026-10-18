import { InvalidInput } from '@on.auto/operations';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { documentOf } from '../testing/definition-documents.ts';
import { answers, textResult } from '../testing/index.ts';
import { reasoningWith } from '../testing/reasoning-runs.ts';

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
