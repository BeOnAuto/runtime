import { describe, expect, it } from 'vitest';

import { documentOf, issuesIn, parsed } from '../testing/definition-documents.ts';

describe('the keys of the front matter', () => {
  it('are the known ones, at every level', () => {
    expect(
      issuesIn(
        documentOf(
          'model: openai/gpt-5\nprompt: hi\nconfig:\n  top_k: 3\ninput:\n  example: {}\noutput:\n  strict: true',
        ),
      ),
    ).toEqual([
      'Line 3, /prompt: prompt is not a key of the front matter; it takes description, model, config, input, output, provider_options, tools',
      'Line 5, /config/top_k: top_k is not a key of config; it takes max_output_tokens, temperature, top_p, seed, stop_sequences, reasoning',
      'Line 7, /input/example: example is not a key of input; it takes schema, default',
      'Line 9, /output/strict: strict is not a key of output; it takes format, schema, shape',
    ]);
  });

  it('need a model', () => {
    expect(issuesIn(documentOf('description: Says hello'))).toEqual(['Line 2, /model: model is required']);
  });
});

describe('the values of the front matter keys', () => {
  it('have the types each key takes', () => {
    expect(
      issuesIn(
        documentOf(
          [
            'description: 12',
            'model: [openai/gpt-5]',
            'config:',
            '  stop_sequences: END',
            '  reasoning: maximal',
            'input: yes',
            'output:',
            '  format: xml',
            'provider_options:',
            '  openai: fast',
          ].join('\n'),
        ),
      ),
    ).toEqual([
      'Line 2, /description: Expected string',
      'Line 3, /model: Expected string',
      'Line 5, /config/stop_sequences: Expected array',
      'Line 6, /config/reasoning: Expected "none" | "minimal" | "low" | "medium" | "high" | "xhigh"',
      'Line 7, /input: Expected object',
      'Line 9, /output/format: Expected "text" | "json"',
      'Line 11, /provider_options/openai: Expected object',
    ]);
  });

  it('take a description of 1 to 1000 characters', () => {
    expect(issuesIn(documentOf('model: openai/gpt-5\ndescription: ""'))).toEqual([
      'Line 3, /description: Expected a value with a length of at least 1',
    ]);
    expect(issuesIn(documentOf(`model: openai/gpt-5\ndescription: ${'x'.repeat(1001)}`))).toEqual([
      'Line 3, /description: Expected a value with a length of at most 1000',
    ]);
    expect(parsed(documentOf(`model: openai/gpt-5\ndescription: ${'x'.repeat(1000)}`)).description).toHaveLength(1000);
  });

  it('pass provider options through, keyed by the provider namespace', () => {
    expect(
      parsed(documentOf('model: openai/gpt-5\nprovider_options:\n  openai: {textVerbosity: low, reasoningMode: pro}'))
        .provider_options,
    ).toEqual({ openai: { textVerbosity: 'low', reasoningMode: 'pro' } });
  });
});
