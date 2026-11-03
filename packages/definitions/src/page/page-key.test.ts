import { Option, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { issueText } from '../document/document-issue.ts';
import {
  documentedPage,
  functionWithPage,
  runsOfTheDayChart,
  pageData,
  pageMappingOf,
  resultOfTheDay,
  workflowWithData,
  workflowWithPage,
} from '../testing/pages.ts';
import { pageIn, savedPageIn } from './page-key.ts';
import type { PageWrittenIn } from './subject-pages-port.ts';

function read(source: string, writtenIn: PageWrittenIn = 'workflow') {
  return Option.getOrUndefined(Result.getOrThrow(pageIn(source, writtenIn)));
}

function issuesIn(source: string, writtenIn: PageWrittenIn = 'workflow'): readonly string[] {
  return Result.match(pageIn(source, writtenIn), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map((issue) => issueText(issue)),
  });
}

describe('the page of a workflow', () => {
  it('is the page key of its document, its data, its result and its runs with the lines they start on', () => {
    const page = read(`do: []\n${documentedPage}`);

    expect(page).toMatchObject({
      data: {
        views: { posts_per_day: 'series', by_channel: 'categories' },
        filters: [{ type: 'run_succeeded', subject: 'workflow/morning-social-content' }],
        foldLine: 13,
      },
      blocks: { result: { line: 41 }, runs: { line: 51 } },
    });
    expect(page?.blocks.result?.text).toContain('{% if run.status == "started" %}');
    expect(page?.templates.runs).toBeDefined();
  });

  it('is none where the document has no page key, and none for an empty page', () => {
    expect(read('name: morning\ndo: []\n')).toBeUndefined();
    expect(read('name: morning\npage: {}\n')).toBeNull();
    expect(read('name: [\n')).toBeUndefined();
  });

  it('takes a template written on the line of its key', () => {
    expect(read('page:\n  result: "{{ output.date }}"\n')?.blocks.result).toEqual({
      text: '{{ output.date }}',
      line: 2,
    });
  });
});

describe('the page of a function', () => {
  it('is the page key of its front matter', () => {
    expect(read(functionWithPage(), 'function')?.blocks.result).toEqual({ text: `${resultOfTheDay}\n`, line: 5 });
    expect(read('---\nmodel: openai/gpt-5\n---\nSay hello.\n', 'function')).toBeUndefined();
    expect(read('Say hello.\n', 'function')).toBeUndefined();
  });
});

describe('the page of the playbook', () => {
  it('is the mapping itself, and refuses YAML that does not read', () => {
    expect(read(pageMappingOf({ data: pageData(), runs: runsOfTheDayChart }), 'playbook')?.data).toMatchObject({
      foldLine: 10,
    });
    expect(read('', 'playbook')).toBeNull();
    expect(issuesIn('data: [\n', 'playbook')).toHaveLength(1);
  });

  it('has no result, since the playbook has no runs of its own', () => {
    expect(issuesIn(pageMappingOf({ result: resultOfTheDay }), 'playbook')).toEqual([
      'Line 1, /result: The playbook has no runs of its own, so its page has no result',
    ]);
  });
});

describe('the keys of a page', () => {
  it('are a mapping of data, result and runs, refused otherwise with their line', () => {
    expect(issuesIn('page: 3\n')).toEqual(['Line 1: page is a mapping of data, result and runs']);
    expect(issuesIn(workflowWithPage({ more: 'model: openai/gpt-5', result: resultOfTheDay }))).toEqual([
      'Line 3, /model: model is not a key of the page; it takes data, result, runs',
    ]);
    expect(issuesIn('page:\n  result: 3\n')).toEqual(['Line 2, /result: Expected string']);
  });

  it('name where an unknown key sits: the page, the page in the front matter of a function, or the page’s data', () => {
    expect(issuesIn(functionWithPage({ more: 'title: Posts', result: resultOfTheDay }), 'function')).toEqual([
      'Line 4, /title: title is not a key of the page in the front matter; it takes data, result, runs',
    ]);
    expect(
      issuesIn(pageMappingOf({ more: 'title: Posts', runs: runsOfTheDayChart, data: pageData() }), 'playbook'),
    ).toEqual(['Line 1, /title: title is not a key of the page; it takes data, result, runs']);
    expect(
      issuesIn(workflowWithData().replace('  language: typescript', '  language: typescript\n    shape: series')),
    ).toEqual(["Line 5, /data/shape: shape is not a key of the page's data; it takes language, source, views, module"]);
  });

  it('pair runs with data, since the views are kept for runs alone', () => {
    const words = 'runs renders the views that data keeps, so a page with runs has data, and a page with data has runs';

    expect(issuesIn(workflowWithPage({ runs: runsOfTheDayChart }))).toEqual([`Line 3, /runs: ${words}`]);
    expect(issuesIn(workflowWithPage({ data: pageData() }))).toEqual([`Line 4, /data: ${words}`]);
  });

  it('read their data as a page reads it, with the lines of the document', () => {
    expect(issuesIn(workflowWithData().replace('language: typescript', 'language: python'))).toEqual([
      "Line 4, /data/language: The playbook's one language is TypeScript; write the module in TypeScript",
    ]);
    expect(read(workflowWithData())?.data?.foldLine).toBe(12);
  });

  it('read their templates with the lines of the document, and at most 32 KiB of them', () => {
    expect(issuesIn(workflowWithPage({ result: '{{ input.date }}' }))).toEqual([expect.stringMatching(/^Line 4: /u)]);
    expect(issuesIn(workflowWithPage({ result: 'é'.repeat(16_385) }))).toEqual([
      "Line 3: The templates take 32771 bytes in UTF-8, more than the 32768 a page's templates may take together",
    ]);
  });
});

describe('a page as it was saved', () => {
  const earlier = workflowWithPage({ data: pageData(), runs: runsOfTheDayChart }).replace('  runs: |', '  lately: |');

  it('reads the runs a page saved before runs had its name wrote as lately', () => {
    const saved = Option.getOrUndefined(Result.getOrThrow(savedPageIn(earlier, 'workflow')));

    expect(saved?.blocks.runs?.text).toBe(
      read(workflowWithPage({ data: pageData(), runs: runsOfTheDayChart }))?.blocks.runs?.text,
    );
    expect(saved?.templates.runs).toBeDefined();
    expect(issuesIn(earlier)).toEqual([expect.stringContaining('lately is not a key of the page')]);
  });

  it('reads a page saved with runs as it is', () => {
    const source = workflowWithPage({ data: pageData(), runs: runsOfTheDayChart });

    expect(Option.getOrUndefined(Result.getOrThrow(savedPageIn(source, 'workflow')))?.blocks).toEqual(
      read(source)?.blocks,
    );
  });
});
