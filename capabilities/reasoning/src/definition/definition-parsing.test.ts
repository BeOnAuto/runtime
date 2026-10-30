import { standingRenderClock } from '@on.auto/definitions/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { documentOf, issuesIn, parsed } from '../testing/definition-documents.ts';

const complete = documentOf(
  [
    'description: Summarizes an account for the sales team',
    'model: anthropic/claude-sonnet-4-5',
    'config:',
    '  max_output_tokens: 800',
    '  temperature: 0.2',
    '  top_p: 0.9',
    '  seed: 7',
    '  stop_sequences: ["END"]',
    '  reasoning: low',
    'input:',
    '  schema:',
    '    type: object',
    '    properties:',
    '      account: { type: string }',
    '      tone: { type: string }',
    '    required: [account]',
    '    additionalProperties: false',
    '  default:',
    '    tone: neutral',
    'output:',
    '  format: json',
    '  schema:',
    '    type: object',
    '    properties:',
    '      summary: { type: string }',
    '    required: [summary]',
    '    additionalProperties: false',
    'provider_options:',
    '  anthropic:',
    '    thinking: { type: enabled, budgetTokens: 1024 }',
  ].join('\n'),
  '{% system %}You write for {{ input.tone }} readers. Today is {{ today }}.{% endsystem %}\nSummarize {{ input.account }}.',
);

describe('a complete reasoning function definition', () => {
  it('parses into the model, the settings, the input, the output, the provider options and the template', () => {
    const definition = parsed(complete);

    expect(definition).toMatchObject({
      description: 'Summarizes an account for the sales team',
      model: 'anthropic/claude-sonnet-4-5',
      settings: {
        max_output_tokens: 800,
        temperature: 0.2,
        top_p: 0.9,
        seed: 7,
        stop_sequences: ['END'],
        reasoning: 'low',
      },
      input: { defaults: { tone: 'neutral' } },
      output: { type: 'json' },
      provider_options: { anthropic: { thinking: { type: 'enabled', budgetTokens: 1024 } } },
      template: { hasInstructions: true, hasMessage: true },
      warnings: [],
    });
    expect(definition.input.schema?.document).toEqual({
      type: 'object',
      properties: { account: { type: 'string' }, tone: { type: 'string' } },
      required: ['account'],
      additionalProperties: false,
    });
  });

  it('renders with the input and the moment', () => {
    const rendered = parsed(complete).template.render(
      { input: { account: 'Globex', tone: 'busy' }, today: '2026-10-01', now: '2026-10-01T09:00:00.000Z' },
      standingRenderClock,
    );

    expect(Result.getOrThrow(rendered)).toEqual({
      instructions: 'You write for busy readers. Today is 2026-10-01.',
      message: '\nSummarize Globex.',
    });
  });
});

describe('the smallest reasoning function definition', () => {
  it('names a model and writes a message', () => {
    expect(parsed('---\nmodel: openai/gpt-5\n---\nSay hello.')).toMatchObject({
      model: 'openai/gpt-5',
      settings: { max_output_tokens: 1024 },
      input: { defaults: {} },
      output: { type: 'text' },
      template: { hasInstructions: false },
      warnings: [],
    });
    expect(issuesIn('---\nmodel: openai/gpt-5\n---\nSay hello.')).toEqual([]);
  });

  it('leaves out what the front matter does not say', () => {
    const definition = parsed('---\nmodel: openai/gpt-5\n---\nSay hello.');

    expect(definition).not.toHaveProperty('description');
    expect(definition).not.toHaveProperty('provider_options');
    expect(definition.input).not.toHaveProperty('schema');
  });
});

describe('the issues of a document', () => {
  it('are all found at once, in the order of their lines', () => {
    expect(
      issuesIn(
        documentOf('model: claude\nconfig:\n  temperature: warm\nflavour: mint', 'Hi {{ customer }} {{ input.a }}'),
      ),
    ).toEqual([
      'Line 2, /model: Expected provider/model, for example anthropic/claude-sonnet-4-5',
      'Line 4, /config/temperature: Expected number',
      'Line 5, /flavour: flavour is not a key of the front matter; it takes description, model, config, input, output, provider_options, tools',
      'Line 7: customer is not a variable of a reasoning function’s prompt template, which reads input, today and now; assign it first',
    ]);
  });

  it('include the template when the front matter cannot be read', () => {
    expect(issuesIn(documentOf('model: [unclosed', '{{ input.a '))).toEqual([
      'Line 2: Flow sequence in block collection must be sufficiently indented and end with a ]',
      'Line 4: output "{{ input.a " not closed',
    ]);
  });

  it('are each reported once', () => {
    const nested = `${'{% system %}'.repeat(2000)}x${'{% endsystem %}'.repeat(2000)}`;

    expect(issuesIn(documentOf('model: openai/gpt-5', nested))).toEqual([
      'Line 4: A template holds at most one {% system %} block',
      'Line 4: {% endsystem %} closes no {% system %}',
      'Line 4: A template may use at most 1000 names in its tags and outputs (variables, properties, filters and keywords); this one uses 4000',
    ]);
  });

  it('are at most 20, with how many more there were, however many the document holds', () => {
    const markers = '{%system%}\n'.repeat(5900);
    const before = process.cpuUsage();
    const issues = issuesIn(documentOf('model: openai/gpt-5', markers));
    const { user, system } = process.cpuUsage(before);

    expect(markers.length).toBeLessThan(65_536);
    expect(issues).toEqual([
      'Line 4: {% system %} is never closed by {% endsystem %}',
      'Line 4: A template may use at most 1000 names in its tags and outputs (variables, properties, filters and keywords); this one uses 5900',
      ...Array.from({ length: 18 }, (_, index) => `Line ${index + 5}: A template holds at most one {% system %} block`),
      'Line 23: 5881 more issues are not shown',
    ]);
    expect((user + system) / 1000).toBeLessThan(400);
  });
});
