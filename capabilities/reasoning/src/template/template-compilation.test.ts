import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { CompiledTemplate, TemplateIssue } from './compiled-template.ts';
import { compileTemplate } from './template-compilation.ts';

function compiled(body: string, firstLine = 1): CompiledTemplate {
  return Result.getOrThrow(compileTemplate(body, firstLine));
}

function issuesOf(body: string, firstLine = 1): readonly TemplateIssue[] {
  return Result.match(compileTemplate(body, firstLine), { onSuccess: () => [], onFailure: (issues) => issues });
}

describe('a template', () => {
  it('compiles plain text and Liquid', () => {
    expect(compiled('Hello {{ input.name }}')).toMatchObject({ hasInstructions: false, hasMessage: true });
    expect(compiled('{% system %}Be brief.{% endsystem %}Hello')).toMatchObject({
      hasInstructions: true,
      hasMessage: true,
    });
  });

  it('knows when it writes nothing outside the system block', () => {
    expect(compiled('\n  \n').hasMessage).toBe(false);
    expect(compiled(' {% system %}Be brief. {{ input.x }}{% endsystem %}\n').hasMessage).toBe(false);
    expect(compiled('{% system %}Be brief.{% endsystem %}{{ input.x }}').hasMessage).toBe(true);
  });

  it('is rejected for Liquid syntax errors, with the line in the document', () => {
    expect(issuesOf('Hello\n{{ input.name ', 7)).toEqual([{ line: 8, detail: 'output "{{ input.name " not closed' }]);
    expect(issuesOf('{% if input.vip %}\nyes', 3)).toEqual([{ line: 3, detail: 'tag {% if input.vip %} not closed' }]);
  });

  it('is rejected for a tag or a filter the engine does not have', () => {
    expect(issuesOf('one\n{% sing %}')).toEqual([{ line: 2, detail: 'tag "sing" not found' }]);
    expect(issuesOf('{{ input.name | shout }}')).toEqual([{ line: 1, detail: 'undefined filter: shout' }]);
  });

  it('is rejected when it is longer than the engine parses', () => {
    expect(issuesOf('x'.repeat(65_537), 4)).toEqual([
      { line: 4, detail: 'A template may take at most 65536 characters' },
    ]);
  });

  it('is rejected when its tags or parentheses nest deeper than the engine reads', () => {
    const tooDeep = { line: 4, detail: 'The tags or parentheses of the template nest too deeply to be read' };
    const tags = `${'{%if a%}'.repeat(3600)}x${'{%endif%}'.repeat(3600)}`;
    const parentheses = `{{ ${'('.repeat(30_000)}1${')'.repeat(30_000)} }}`;

    expect([tags.length, parentheses.length].every((length) => length <= 65_536)).toBe(true);
    expect(issuesOf(tags, 4)).toEqual([tooDeep]);
    expect(issuesOf(parentheses, 4)).toEqual([tooDeep]);
  });
});

describe('the tags that load other templates', () => {
  it.each([
    ['include', '{% include "header" %}'],
    ['render', '{% render "header" %}'],
    ['layout', '{% layout "page" %}'],
    ['block', '{% block body %}{% endblock %}'],
  ])('are not available: %s', (tag, body) => {
    expect(issuesOf(body)).toEqual([{ line: 1, detail: `tag "${tag}" not found` }]);
  });

  it('include capture, which renders outside the limit on the rendered size', () => {
    expect(issuesOf('{% capture greeting %}Hi{% endcapture %}')).toEqual([
      { line: 1, detail: 'tag "capture" not found' },
    ]);
  });
});

describe('the system block', () => {
  it('takes no arguments', () => {
    expect(issuesOf('{% system formal %}Be formal.{% endsystem %}')).toEqual([
      { line: 1, detail: '{% system %} takes no arguments' },
    ]);
    expect(issuesOf('{% system %}Be formal.{% endsystem now %}')).toEqual([
      { line: 1, detail: '{% endsystem %} takes no arguments' },
    ]);
  });

  it('appears at most once', () => {
    expect(issuesOf('{% system %}a{% endsystem %}\n{% system %}b{% endsystem %}')).toEqual([
      { line: 2, detail: 'A template holds at most one {% system %} block' },
      { line: 2, detail: '{% endsystem %} closes no {% system %}' },
    ]);
    expect(issuesOf('{% system %}a\n{% system %}b{% endsystem %}')).toEqual([
      { line: 2, detail: 'A template holds at most one {% system %} block' },
    ]);
  });

  it('must be closed, and closes only what was opened', () => {
    expect(issuesOf('Hello\n{% system %}Be brief.')).toEqual([
      { line: 2, detail: '{% system %} is never closed by {% endsystem %}' },
    ]);
    expect(issuesOf('Be brief.{% endsystem %}')).toEqual([
      { line: 1, detail: '{% endsystem %} closes no {% system %}' },
    ]);
  });

  it('stands at the top level, outside every other tag', () => {
    expect(issuesOf('{% if input.formal %}\n{% system %}Be formal.{% endsystem %}\n{% endif %}', 10)).toEqual([
      { line: 11, detail: '{% system %} must stand at the top level of the template, outside every other tag' },
      { line: 11, detail: '{% endsystem %} must stand at the top level of the template, outside every other tag' },
    ]);
    expect(
      issuesOf('{% for item in input.items %}{% if item %}{% liquid\nsystem\nendsystem %}{% endif %}{% endfor %}'),
    ).toEqual([
      { line: 2, detail: '{% system %} must stand at the top level of the template, outside every other tag' },
      { line: 3, detail: '{% endsystem %} must stand at the top level of the template, outside every other tag' },
    ]);
  });

  it('is plain text inside raw and ignored inside comments', () => {
    expect(compiled('{% raw %}{% system %}{% endraw %}').hasInstructions).toBe(false);
    expect(compiled('{% comment %}{% system %}{% endcomment %}{% # {% system %} %}').hasInstructions).toBe(false);
  });
});

describe('the variables a template reads', () => {
  it('are every name it reads from outside, with their paths and lines', () => {
    const { variables } = compiled(
      '{% assign tone = input.tone %}{{ tone }}\n{% for item in input.items %}{{ item.name }}{{ forloop.index }}{% endfor %}\n{{ input.list[0] }}{{ input[input.key] }} {{ today }}',
      5,
    );

    expect(variables).toEqual([
      { path: ['input', 'tone'], line: 5 },
      { path: ['input', 'items'], line: 6 },
      { path: ['input', 'list', 0], line: 7 },
      { path: ['input', null], line: 7 },
      { path: ['input', 'key'], line: 7 },
      { path: ['today'], line: 7 },
    ]);
  });

  it('include the names read inside the system block', () => {
    expect(compiled('{% system %}You serve {{ input.company }}.{% endsystem %}{{ now }}').variables).toEqual([
      { path: ['input', 'company'], line: 1 },
      { path: ['now'], line: 1 },
    ]);
  });
});

describe('the names in tags and outputs', () => {
  it('may number 1000', () => {
    const body = `${'{{ input.a }}'.repeat(499)}{{ 1 }}{{ x }}{{ y }}`;

    expect(compiled(body).variables).toHaveLength(501);
  });

  it('are rejected above 1000, before the template is analysed', () => {
    expect(issuesOf('{{ input.a }}'.repeat(501), 2)).toEqual([
      {
        line: 2,
        detail:
          'A template may use at most 1000 names in its tags and outputs (variables, properties, filters and keywords); this one uses 1002',
      },
    ]);
  });
});
