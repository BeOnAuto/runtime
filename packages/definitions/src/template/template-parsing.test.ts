import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  literalTextOf,
  parsedTemplate,
  templateEngine,
  templateLimits,
  type ParsedTemplate,
  type TemplateIssue,
} from '../template.ts';

const engine = templateEngine();

function parsed(body: string, firstLine = 1): ParsedTemplate {
  return Result.getOrThrow(parsedTemplate(engine, body, firstLine));
}

describe('a template that parses', () => {
  it('names the variables it reads with their lines in the document, a part named by a value as unknown', () => {
    expect(parsed('Hi {{ input.name }}\n{{ input.items[input.key] }} {{ today }}', 4).variables).toEqual([
      { path: ['input', 'name'], line: 4 },
      { path: ['input', 'items', null], line: 5 },
      { path: ['input', 'key'], line: 5 },
      { path: ['today'], line: 5 },
    ]);
  });

  it('keeps the text it was parsed from and the line of the document it starts on', () => {
    const { text, firstLine } = parsed('Hi {{ input.name }}', 4);

    expect({ text, firstLine }).toEqual({ text: 'Hi {{ input.name }}', firstLine: 4 });
  });

  it('notes, beside it, when it uses more names than a template may', () => {
    const many = Array.from({ length: templateLimits.names + 1 }, (_, index) => `{{ n${index} }}`).join('');

    expect(parsed(many).issues).toEqual([
      {
        line: 1,
        detail: `A template may use at most 1000 names in its tags and outputs (variables, properties, filters and keywords); this one uses ${templateLimits.names + 1}`,
      },
    ]);
    expect([parsed('{{ a }}').issues, parsed('{{ 1 }}').issues]).toEqual([[], []]);
  });
});

describe('the literal text of a template', () => {
  const inPlaceOf = new Map([['topic', 'T']]);

  it('is what it writes whatever its values: its text outside every output and tag, in order', () => {
    expect(literalTextOf(parsed('https://a.example.com/{{ id }}/b{% if id %}/c{% endif %}?d'), inPlaceOf)).toBe(
      'https://a.example.com//b?d',
    );
  });

  it('holds nothing for an output after a tag, which may have assigned its name', () => {
    expect(literalTextOf(parsed('/{{ topic }}{% assign topic = "x" %}/{{ topic }}/'), inPlaceOf)).toBe('/T//');
  });

  it('holds the text given for an output that writes that name alone, and nothing for any other output', () => {
    expect(literalTextOf(parsed('/{{ topic }}/{{topic}}/{{- topic -}}/'), inPlaceOf)).toBe('/T/T/T/');
    expect(literalTextOf(parsed('/{{ topic | append: "/" }}/{{ topic.size }}/{{ constructor }}'), inPlaceOf)).toBe(
      '///',
    );
  });
});

describe('a template that does not parse', () => {
  const refused: ReadonlyArray<readonly [string, string, number, readonly TemplateIssue[]]> = [
    ['an output not closed', 'Hello\n{{ input.a ', 3, [{ line: 4, detail: 'output "{{ input.a " not closed' }]],
    [
      'a template too long',
      'x'.repeat(templateLimits.characters + 1),
      1,
      [{ line: 1, detail: `A template may take at most ${templateLimits.characters} characters` }],
    ],
    [
      'tags nested too deeply',
      `${'{%if a%}'.repeat(3600)}x${'{%endif%}'.repeat(3600)}`,
      1,
      [{ line: 1, detail: 'The tags or parentheses of the template nest too deeply to be read' }],
    ],
  ];

  it.each(refused)('is refused with %s', (_case, body, firstLine, issues) => {
    expect(parsedTemplate(engine, body, firstLine)).toEqual(Result.fail(issues));
  });
});
