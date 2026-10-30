import { describe, expect, it } from 'vitest';

import { documentOf, issuesIn, parsed } from '../testing/definition-documents.ts';

const closedInput = [
  'model: openai/gpt-5',
  'input:',
  '  schema:',
  '    type: object',
  '    properties: {account: {type: string}, notes: {type: array}}',
  '    additionalProperties: false',
].join('\n');

const openInput = 'model: openai/gpt-5\ninput:\n  schema: {type: object, properties: {account: {type: string}}}';

describe('the variables a template reads', () => {
  it('are input, today and now, and what the template assigns', () => {
    expect(
      issuesIn(
        documentOf(
          'model: openai/gpt-5',
          '{% assign who = input.who %}{% for note in input.notes %}{{ note.text }} {{ forloop.index }}{% endfor %}\n{{ who }} {{ today }} {{ now }}',
        ),
      ),
    ).toEqual([]);
  });

  it('are nothing else, each named once on its line', () => {
    expect(
      issuesIn(documentOf('model: openai/gpt-5', 'Hello {{ user }} and {{ user.name }}\n{{ secrets.key }}')),
    ).toEqual([
      'Line 4: user is not a variable of a reasoning function’s prompt template, which reads input, today and now; assign it first',
      'Line 5: secrets is not a variable of a reasoning function’s prompt template, which reads input, today and now; assign it first',
    ]);
  });

  it('read today and now whole', () => {
    expect(
      issuesIn(documentOf('model: openai/gpt-5', '{{ today.year }}\n{{ now.hour }} {{ today | slice: 0, 4 }}')),
    ).toEqual([
      'Line 4: today is the date, as YYYY-MM-DD, and has no properties',
      'Line 5: now is the time, in ISO 8601, and has no properties',
    ]);
  });
});

describe('the fields of the input a template reads', () => {
  it('are declared properties when the input schema allows no others', () => {
    expect(
      issuesIn(
        documentOf(
          closedInput,
          '{{ input.account }} {{ input.notes.size }} {{ input[input.account] }}\n{{ input.acount }}',
        ),
      ),
    ).toEqual(['Line 10: input.acount is not a property of the input schema, which allows no others']);
  });

  it('are none when the input schema declares no properties and allows no others', () => {
    expect(
      issuesIn(
        documentOf(
          'model: openai/gpt-5\ninput:\n  schema: {type: object, additionalProperties: false}',
          '{{ input.x }}',
        ),
      ),
    ).toEqual(['Line 6: input.x is not a property of the input schema, which allows no others']);
  });

  it('are any field when the input schema allows others, or when there is none', () => {
    expect(issuesIn(documentOf(openInput, '{{ input.anything }}'))).toEqual([]);
    expect(issuesIn(documentOf('model: openai/gpt-5', '{{ input.anything }}'))).toEqual([]);
  });
});

describe('the template of a definition', () => {
  it('reports its own issues with the lines of the document', () => {
    expect(issuesIn(documentOf('model: openai/gpt-5', 'One\n{% if input.x %}Two'))).toEqual([
      'Line 5: tag {% if input.x %} not closed',
    ]);
  });

  it('writes a message outside the system block', () => {
    expect(issuesIn(documentOf('model: openai/gpt-5', '{% system %}Be brief.{% endsystem %}\n'))).toEqual([
      'Line 4: The template writes no message: write it after the front matter, outside the {% system %} block',
    ]);
    expect(issuesIn('---\nmodel: openai/gpt-5\n---')).toEqual([
      'Line 4: The template writes no message: write it after the front matter, outside the {% system %} block',
    ]);
  });

  it('may hold instructions in a system block', () => {
    expect(
      parsed(documentOf('model: openai/gpt-5', '{% system %}Be brief.{% endsystem %}Hi')).template.hasInstructions,
    ).toBe(true);
  });
});
