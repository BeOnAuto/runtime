import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { issueText } from '../document/document-issue.ts';
import { pageData, pageOf, pageWithData } from '../testing/pages.ts';
import { parsePageDocument } from './page-parsing.ts';

function issuesIn(source: string): readonly string[] {
  return Result.match(parsePageDocument(source), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map((issue) => issueText(issue)),
  });
}

function resultOf(body: string): string {
  return pageOf({ body: `{% result %}\n${body}\n{% endresult %}` });
}

function runsOf(body: string): string {
  return pageOf({ body: `{% lately %}\n${body}\n{% endlately %}`, data: pageData() });
}

describe('the templates of a page, when it is saved', () => {
  it('are refused where they do not compile, or name a tag or a filter a page does not have, with the line', () => {
    expect(issuesIn(resultOf('{{ output.date | date: "%Y" }}'))).toEqual([expect.stringContaining('Line 4:')]);
    expect(issuesIn(resultOf('{{ output.title | inspect }}'))).toEqual([expect.stringContaining('Line 4:')]);
    expect(issuesIn(resultOf("{% include 'header' %}"))).toEqual([expect.stringContaining('Line 4:')]);
    expect(issuesIn(resultOf('{% capture text %}x{% endcapture %}'))).toEqual([expect.stringContaining('Line 4:')]);
    expect(issuesIn(resultOf('{% system %}Be brief{% endsystem %}'))).toEqual([expect.stringContaining('Line 4:')]);
    expect(issuesIn(resultOf('{% tablerow post in output.posts %}{{ post.title }}{% endtablerow %}'))).toEqual([
      expect.stringContaining('Line 4:'),
    ]);
    expect(issuesIn(resultOf('{% unknown %}'))).toEqual([expect.stringContaining('Line 4:')]);
  });

  it('are refused where a tag or an output is not closed, saying how to close it', () => {
    expect([
      issuesIn(resultOf('{% if output.posts %}')),
      issuesIn(resultOf('{% raw %}{{ output }}')),
      issuesIn(resultOf('{{ output.title')),
    ]).toEqual([
      ['Line 4: The tag if is not closed with {% endif %}'],
      ['Line 4: The tag raw is not closed with {% endraw %}'],
      ['Line 4: An output opened with {{ is not closed with }}'],
    ]);
    expect(issuesIn(resultOf('{% assign %}'))).toEqual(['Line 4: expected variable name']);
  });

  it('are refused past the names a template may use', () => {
    expect(issuesIn(resultOf(`{{ ${Array.from({ length: 1001 }, () => 'output').join(' | append: ')} }}`))).toEqual([
      expect.stringContaining('Line 3:'),
    ]);
  });
});

describe('the variables of result', () => {
  it('are the output, the run, the subject, today and now, and the names the template makes', () => {
    const body = [
      '{% assign posts = output.posts %}{% for post in posts %}{{ post.title }}{% endfor %}',
      '{% increment shown %}{% cycle "a", "b" %}',
      '{{ run.status }} {{ run.started }} {{ run.ended }} {{ run.version }} {{ subject.name }} {{ today }} {{ now }}',
    ].join('\n');

    expect(issuesIn(resultOf(body))).toEqual([]);
  });

  it('refuse anything else, with its line', () => {
    expect(issuesIn(resultOf('{{ views.by_day }}\n{{ run.cost }}\n{{ today.year }}\n{{ subject.owner }}'))).toEqual([
      expect.stringContaining('Line 4:'),
      expect.stringContaining('Line 5:'),
      'Line 6: today is the date, as YYYY-MM-DD, and has no fields',
      expect.stringContaining('Line 7:'),
    ]);
  });
});

describe('the variables of runs', () => {
  it('are the views data.views declares, the subject, today and now', () => {
    expect(
      issuesIn(runsOf('{{ views.by_day | json }} {{ views[subject.name] }} {{ views | json }} {{ now }}')),
    ).toEqual([]);
  });

  it('refuse the output, and a view data.views does not declare', () => {
    expect(issuesIn(runsOf('{{ output.posts }}\n{{ views.by_week }}'))).toEqual([
      expect.stringContaining('Line 16:'),
      expect.stringContaining('Line 17:'),
    ]);
  });
});

describe('the chart fences a template writes out', () => {
  it('are refused for a kind or a role the table of kinds does not give, with the line of the fence', () => {
    const fences = ['```chart pie', '{{ views.by_day | json }}', '```', '```chart line x=at', 'null', '```'].join('\n');

    expect(issuesIn(runsOf(fences))).toEqual([
      expect.stringContaining('Line 16:'),
      'Line 19: A line chart supports no roles; leave out x',
    ]);
  });

  it('are checked when they render where the template writes their info string', () => {
    expect(issuesIn(runsOf('```chart {{ subject.name }}\n{{ views.by_day | json }}\n```'))).toEqual([]);
    expect(issuesIn(pageWithData())).toEqual([]);
  });
});
