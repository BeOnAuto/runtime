import { Result } from 'effect';
import { tags } from 'liquidjs';
import { describe, expect, it } from 'vitest';

import type { TemplateIssue } from './compiled-template.ts';
import { compileTemplate } from './template-compilation.ts';

const keptTags = [
  '{% assign a = 1 %}',
  '{% case input.a %}{% when 1 %}one{% else %}other{% endcase %}',
  '{% comment %}note{% endcomment %}',
  '{% # note %}',
  '{% cycle "a", "b" %}',
  '{% increment n %}{% decrement n %}',
  '{% echo input.a %}',
  '{% for item in input.list %}{% break %}{% continue %}{% endfor %}',
  '{% if input.a %}{% elsif input.b %}{% else %}{% endif %}',
  '{% unless input.a %}{% endunless %}',
  '{% liquid\nassign b = 2\necho b %}',
  '{% raw %}{{ not rendered }}{% endraw %}',
  '{% tablerow item in input.list %}{{ item }}{% endtablerow %}',
];

const removedTags = ['include', 'render', 'layout', 'block', 'capture'];

function issuesOf(body: string): readonly TemplateIssue[] {
  return Result.match(compileTemplate(body, 1), { onSuccess: () => [], onFailure: (issues) => issues });
}

describe('the tags a template may use', () => {
  it.each(keptTags)('include %s', (body) => {
    expect(issuesOf(body)).toEqual([]);
  });

  it('are every tag of the engine but those that load or capture templates, and the system block', () => {
    expect(new Set(Object.keys(tags))).toEqual(
      new Set([
        ...removedTags,
        'assign',
        'break',
        'case',
        'comment',
        'continue',
        'cycle',
        'decrement',
        'echo',
        'for',
        'if',
        'increment',
        'liquid',
        'raw',
        'tablerow',
        'unless',
        '#',
      ]),
    );
  });
});
