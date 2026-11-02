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

function latelyOf(body: string): string {
  return pageOf({ body: `{% lately %}\n${body}\n{% endlately %}`, data: pageData() });
}

describe('the templates of a page, when it is saved', () => {
  it('are refused where they do not compile, or name a tag or a filter a page does not have, with the line', () => {
    expect(issuesIn(resultOf('{{ output.date | date: "%Y" }}'))).toEqual([
      "Line 5: The filter date is not available, since it reads the server's clock and time zone; read today or now instead",
    ]);
    expect(issuesIn(resultOf('{{ output.title | inspect }}'))).toEqual([
      'Line 5: The filter inspect is not available; the templates guide lists the filters a template may use',
    ]);
    expect(issuesIn(resultOf("{% include 'header' %}"))).toEqual([
      'Line 5: The tag include is not available, since a page is a single document',
    ]);
    expect(issuesIn(resultOf('{% capture text %}x{% endcapture %}'))).toEqual([
      'Line 5: The tag capture is not available; build the text with assign and append instead',
    ]);
    expect(issuesIn(resultOf('{% system %}Be brief{% endsystem %}'))).toEqual([
      "Line 5: The tag system is not available, since only a reasoning function's prompt has it",
    ]);
    expect(issuesIn(resultOf('{% tablerow post in output.posts %}{{ post.title }}{% endtablerow %}'))).toEqual([
      'Line 5: The tag tablerow is not available, since it writes HTML, which every client shows as text; write the rows with for',
    ]);
    expect(issuesIn(resultOf('{% unknown %}'))).toEqual([
      'Line 5: The tag unknown is not available; the page format lists the tags a page may use',
    ]);
  });

  it('are refused where a tag or an output is not closed, saying how to close it', () => {
    expect([
      issuesIn(resultOf('{% if output.posts %}')),
      issuesIn(resultOf('{% raw %}{{ output }}')),
      issuesIn(resultOf('{{ output.title')),
    ]).toEqual([
      ['Line 5: The tag if is not closed with {% endif %}'],
      ['Line 5: The tag raw is not closed with {% endraw %}'],
      ['Line 5: An output opened with {{ is not closed with }}'],
    ]);
    expect(issuesIn(resultOf('{% assign %}'))).toEqual(['Line 5: expected variable name']);
  });

  it('are refused past the names a template may use', () => {
    expect(issuesIn(resultOf(`{{ ${Array.from({ length: 1001 }, () => 'output').join(' | append: ')} }}`))).toEqual([
      'Line 4: A template may use at most 1000 names in its tags and outputs (variables, properties, filters and keywords); this one uses 2001',
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
      'Line 5: views is not a variable of result, which reads output, run, subject, today and now; assign it first',
      'Line 6: run.cost is not a field of run, which is the run, with status, started, ended and version',
      'Line 7: today is the date, as YYYY-MM-DD, and has no fields',
      'Line 8: subject.owner is not a field of subject, which is the subject, with type, name, description and version',
    ]);
  });
});

describe('the variables of lately', () => {
  it('are the views data.views declares, the subject, today and now', () => {
    expect(
      issuesIn(latelyOf('{{ views.by_day | json }} {{ views[subject.name] }} {{ views | json }} {{ now }}')),
    ).toEqual([]);
  });

  it('refuse the output, and a view data.views does not declare', () => {
    expect(issuesIn(latelyOf('{{ output.posts }}\n{{ views.by_week }}'))).toEqual([
      'Line 17: output is not a variable of lately, which reads views, subject, today and now; assign it first',
      'Line 18: views.by_week is not a view that data.views declares; it declares by_day',
    ]);
  });
});

describe('the chart fences a template writes out', () => {
  it('are refused for a kind or a role the table of kinds does not give, with the line of the fence', () => {
    const fences = ['```chart pie', '{{ views.by_day | json }}', '```', '```chart line x=at', 'null', '```'].join('\n');

    expect(issuesIn(latelyOf(fences))).toEqual([
      'Line 17: Specify a chart type after chart: line, bars, stacked, share, histogram, scatter, bubble, heatmap, range, funnel, calendar, timeline, table, figure, text',
      'Line 20: A line chart supports no roles; leave out x',
    ]);
  });

  it('are checked when they render where the template writes their info string', () => {
    expect(issuesIn(latelyOf('```chart {{ subject.name }}\n{{ views.by_day | json }}\n```'))).toEqual([]);
    expect(issuesIn(pageWithData())).toEqual([]);
  });
});
