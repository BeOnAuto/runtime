import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { issueText } from '../document/document-issue.ts';
import { parsePageDocument } from '../page/page-parsing.ts';
import { pageData, pageOf } from '../testing/pages.ts';

function issuesIn(source: string): readonly string[] {
  return Result.match(parsePageDocument(source), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map((issue) => issueText(issue)),
  });
}

function resultOf(...lines: readonly string[]): string {
  return pageOf({ body: `{% result %}\n${lines.join('\n')}\n{% endresult %}` });
}

const chart = ['```chart line', '{{ views.by_day | json }}', '```'];

describe('the rows a template writes out, when the page is saved', () => {
  it('are taken with two to four cells, each closed by a line of :::', () => {
    const lately = [
      '{% lately %}',
      '::: row',
      '#### Posts each day',
      ...chart,
      '---',
      '#### Posts, again',
      ...chart,
      ':::',
      '',
      '---',
      '',
      ':::row',
      'One',
      '---',
      'Two',
      '---',
      '```text',
      '---',
      ':::',
      '```',
      '---',
      'Four',
      ':::',
      '{% endlately %}',
    ].join('\n');

    expect(issuesIn(pageOf({ body: lately, data: pageData() }))).toEqual([]);
  });
});

describe('the rows a template writes out that break a rule', () => {
  it('are refused when one is never closed, or opens inside another, with the line', () => {
    expect(issuesIn(resultOf('::: row', 'One', '---', 'Two'))).toEqual([
      'Line 4: This row is never closed: write ::: on a line of its own after its last cell',
    ]);
    expect(issuesIn(resultOf('::: row', 'One', '---', '::: row', 'Two', '---', 'Three', ':::', ':::'))).toEqual([
      'Line 7: Rows do not nest: close the row above with ::: before opening another',
    ]);
    expect(issuesIn(resultOf('::: row', 'One', '---', 'Two', '::: row', 'Three', '---', 'Four', ':::'))).toEqual([
      'Line 4: This row is never closed: write ::: on a line of its own after its last cell',
      'Line 8: Rows do not nest: close the row above with ::: before opening another',
    ]);
  });

  it('are refused for a ::: that closes nothing, and for any other line that starts a container', () => {
    expect(issuesIn(resultOf('One', ':::', '::: column', '  ::: row', 'Two'))).toEqual([
      'Line 5: This ::: closes no row, since no row is open here',
      'Line 6: A row opens with ::: row and closes with :::, each alone on its line, and ::: column is neither',
      'Line 7: A row stands at the top level: write its ::: lines at the start of the line, with no space before them',
    ]);
  });
});

describe('the cells of a row a template writes out', () => {
  it('are refused with fewer than 2 or more than 4', () => {
    expect([
      issuesIn(resultOf('::: row', 'One', ':::')),
      issuesIn(resultOf('::: row', 'One', '---', 'Two', '---', 'Three', '---', 'Four', '---', 'Five', ':::')),
    ]).toEqual([
      ['Line 4: This row holds 1 cell, and a row holds 2 to 4, separated by lines of ---'],
      ['Line 4: This row holds 5 cells, and a row holds 2 to 4, separated by lines of ---'],
    ]);
  });

  it('are refused for a cell left empty, at the line before it', () => {
    expect(issuesIn(resultOf('::: row', '', '---', 'Two', '---', '  ', ':::'))).toEqual([
      'Line 4: The cell after this line is empty: write its Markdown, or leave the cell out',
      'Line 8: The cell after this line is empty: write its Markdown, or leave the cell out',
    ]);
  });

  it('have their cells counted when they render where a tag stands among their lines', () => {
    const cells = [
      '::: row',
      '{% for post in output.posts %}',
      '{{ post.title }}',
      '{% unless forloop.last %}',
      '---',
      '{% endunless %}',
      '{% endfor %}',
      ':::',
    ];

    expect(issuesIn(resultOf(...cells))).toEqual([]);
    expect(issuesIn(resultOf('::: row', '{% if output.title %}{{ output.title }}{% endif %}', ':::'))).toEqual([]);
  });
});
