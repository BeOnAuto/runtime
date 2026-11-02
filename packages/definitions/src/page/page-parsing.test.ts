import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { issueText } from '../document/document-issue.ts';
import { documentedPage, latelyOfTheDays, pageData, pageOf, pageWithData, resultOfTheDate } from '../testing/pages.ts';
import { parsePageDocument } from './page-parsing.ts';

function issuesIn(source: string): readonly string[] {
  return Result.match(parsePageDocument(source), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map((issue) => issueText(issue)),
  });
}

function filtersOf(events: string): string {
  return pageWithData().replace(
    '    events:\n      - type: run_succeeded\n        subject: workflow/morning-social-content',
    `    events: ${events}`,
  );
}

function parsed(source: string) {
  return Result.getOrThrow(parsePageDocument(source));
}

describe('the documented page', () => {
  it('names its subject, its views and its folded events, with its two blocks and the lines they start on', () => {
    const page = parsed(documentedPage);

    expect(page).toMatchObject({
      description: 'The posts the morning social content workflow drafts, run by run and over time',
      of: 'workflow/morning-social-content',
      ofLine: 3,
      data: {
        views: { posts_per_day: 'series', by_channel: 'categories' },
        filters: [{ type: 'run_succeeded', subject: 'workflow/morning-social-content' }],
        filterExpressions: [],
        foldLine: 14,
      },
      blocks: { result: { line: 42 }, lately: { line: 54 } },
    });
    expect(page.data?.fold.split('\n')[0]).toBe('export function fold(view: View, event: Event): View {');
    expect(page.blocks.result?.text).toContain('{% if run.status == "started" %}');
    expect(page.blocks.lately?.text).toContain('```chart bars');
  });
});

describe('the subject of a page', () => {
  it('is a workflow or a function by its type and name, or the playbook', () => {
    expect(parsed(pageOf({ of: 'reasoning/review-brief' })).of).toBe('reasoning/review-brief');
    expect(parsed(pageOf({ of: 'playbook', body: latelyOfTheDays, data: pageData() })).of).toBe('playbook');
  });

  it('is required, and refused when it names no subject the page can present', () => {
    const notASubject =
      'Line 2, /of: of names the subject whose results the page presents: <type>/<name>, where the type is workflow, reasoning, lookup, interaction, prediction or computation, or playbook';

    expect(issuesIn('---\ndescription: No subject\n---\n{% result %}{% endresult %}\n')).toEqual([
      'Line 1, /of: of is required',
    ]);
    expect(issuesIn(pageOf({ of: 'campaigns' }))).toEqual([notASubject]);
    expect(issuesIn(pageOf({ of: 'workflow/Morning' }))).toEqual([notASubject]);
    expect(issuesIn(pageOf({ of: 'workflow/morning/posts' }))).toEqual([notASubject]);
    expect(issuesIn(pageOf({ of: 'dataset/morning-posts' }))).toEqual([notASubject]);
  });

  it('is never a page, since a page has no results to present', () => {
    expect(issuesIn(pageOf({ of: 'page/morning-posts' }))).toEqual([
      'Line 2, /of: A page presents no page, since a page has no results to present; of names a workflow, a function or playbook',
    ]);
  });
});

describe('the fields of a page', () => {
  it('are refused when they are not a page’s, with their line, among them the fields of a function', () => {
    const front = 'model: anthropic/claude-sonnet-4-5\nlanguage: typescript\ninput:\n  schema: { type: object }';

    expect(issuesIn(pageOf({ front }))).toEqual([
      'Line 3, /model: model is not a key of the front matter; it takes description, of, data',
      'Line 4, /language: language is not a key of the front matter; it takes description, of, data',
      'Line 6, /input: input is not a key of the front matter; it takes description, of, data',
    ]);
  });

  it('report what is wrong with the blocks beside what is wrong with the front matter', () => {
    expect(issuesIn('---\nof: [\n---\nWelcome\n')).toHaveLength(2);
    expect(issuesIn('---\ndescription: ""\nof: playbook\n---\nWelcome\n')).toEqual([
      'Line 2, /description: Expected a value with a length of at least 1',
      'Line 5: Put page content inside {% result %} or {% lately %} blocks. Only whitespace is allowed outside them',
    ]);
  });
});

describe('the data of a page', () => {
  it('needs its language, its events, its views and its module, and takes nothing else', () => {
    expect(issuesIn(pageOf({ body: latelyOfTheDays, data: 'data:\n  language: typescript\n  shape: series' }))).toEqual(
      [
        'Line 4, /data/source: source is required',
        'Line 4, /data/views: views is required',
        'Line 4, /data/module: module is required',
        'Line 5, /data/shape: shape is not a key of data; it takes language, source, views, module',
      ],
    );
  });

  it('is written in TypeScript, the playbook’s one language', () => {
    const python = pageWithData().replace('language: typescript', 'language: python');

    expect(issuesIn(python)).toEqual([
      "Line 4, /data/language: The playbook's one language is TypeScript; write the module in TypeScript",
    ]);
  });

  it('names 1 to 8 views, each a name a template reads and the name of a shape', () => {
    const nine = Array.from({ length: 9 }, (_, index) => `view_${index}: text`).join('\n');

    expect(issuesIn(pageWithData({ views: '{}' }))).toEqual([
      'Line 10, /data/views: data.views names 1 to 8 views; it names 0',
    ]);
    expect(issuesIn(pageWithData({ views: nine }))).toEqual([
      'Line 10, /data/views: data.views names 1 to 8 views; it names 9',
    ]);
    expect(issuesIn(pageWithData({ views: 'By-Day: series\nby_week: chart' }))).toEqual([
      "Line 10, /data/views/By-Day: A view's name is 1 to 32 lowercase letters, digits and underscores, beginning with a letter, so that a template reads it as views.<name>",
      'Line 11, /data/views/by_week: Expected the name of a shape: series, categories, table, or text',
    ]);
  });
});

describe('the events the data of a page folds', () => {
  it('are named by 1 to 8 filters, each a mapping of literal attributes', () => {
    const nine = `[${Array.from({ length: 9 }, () => '{type: run_succeeded}').join(', ')}]`;

    expect(issuesIn(filtersOf('[]'))).toEqual([
      'Line 6, /data/source/events: A page folds the events at least one filter names; it names none',
    ]);
    expect(issuesIn(filtersOf(nine))).toEqual([
      'Line 6, /data/source/events: A page takes at most 8 filters; it names 9',
    ]);
    expect(issuesIn(filtersOf('[run_succeeded]'))[0]).toBe(
      'Line 6, /data/source/events/0: A filter is a mapping of the attributes an event must have: type, and optionally any other attribute of the event and its data',
    );
    expect(issuesIn(filtersOf('[{subject: workflow/morning-social-content}]'))).toHaveLength(1);
  });

  it('keeps each filter expression with its line, for the check of the module', () => {
    const page = parsed(
      pageWithData().replace(
        '        subject: workflow/morning-social-content',
        "        data: '${ $data.output != null }'",
      ),
    );

    expect(page.data?.filterExpressions).toEqual([
      { source: ' $data.output != null ', pointer: '/data/source/events/0/data', line: 8 },
    ]);
  });
});

describe('the module of a page', () => {
  it('exports fold, counted in the lines of the page, and never answer', () => {
    const answering =
      'export function fold(view: View, event: Event): View {\n  return view;\n}\n\nexport function answer(view: View): View {\n  return view;\n}';

    expect(parsed(pageWithData()).data?.foldLine).toBe(12);
    expect(issuesIn(pageWithData({ module: answering }))).toEqual([
      'Line 16: The module exports answer, but a page never runs: its module exports fold alone',
    ]);
    expect(issuesIn(pageWithData().replace(/ {2}module: \|[\s\S]*?---/u, "  module: ' '\n---"))).toEqual([
      'Line 11, /data/module: data.module holds the TypeScript module that exports fold; it is empty',
    ]);
  });

  it('starts on the line of module when the module is written on it', () => {
    const inline = pageWithData().replace(
      / {2}module: \|[\s\S]*?---/u,
      "  module: 'export function fold(view: View): View { return view; }'\n---",
    );

    expect(parsed(inline).data?.foldLine).toBe(11);
  });
});

describe('the blocks of a page', () => {
  it('are result, lately or both, and nothing but white space stands outside them', () => {
    expect(issuesIn(pageOf({ body: '\n  \n' }))).toEqual([
      'Line 4: A page shows at least one block: {% result %} … {% endresult %}, {% lately %} … {% endlately %} or both',
    ]);
    expect(issuesIn(pageOf({ body: `# Posts\n${resultOfTheDate}\n{{ output.date }}` }))).toEqual([
      'Line 4: Put page content inside {% result %} or {% lately %} blocks. Only whitespace is allowed outside them',
      'Line 8: Put page content inside {% result %} or {% lately %} blocks. Only whitespace is allowed outside them',
    ]);
  });

  it('stand at the top level, each written once, with no arguments', () => {
    expect(issuesIn(pageOf({ body: `{% if true %}${resultOfTheDate}{% endif %}` }))).toEqual([
      'Line 4: Put each block at the top level, outside other blocks and tags',
    ]);
    expect(
      issuesIn(
        pageOf({
          body: `{% if true %}\n{% for day in days %}\n${resultOfTheDate}\n{% endfor %}{% else %}x{% endif %}`,
        }),
      ),
    ).toEqual(['Line 6: Put each block at the top level, outside other blocks and tags']);
    expect(issuesIn(pageOf({ body: `{% if true %}x{% endif %}\n${resultOfTheDate}\n{% unless true %}y` }))).toEqual(
      ['Line 4', 'Line 8'].map(
        (line) =>
          `${line}: Put page content inside {% result %} or {% lately %} blocks. Only whitespace is allowed outside them`,
      ),
    );
    expect(issuesIn(pageOf({ body: `${resultOfTheDate}\n${resultOfTheDate}` }))).toEqual([
      'Line 7: A page writes {% result %} at most once',
    ]);
    expect(issuesIn(pageOf({ body: '{% result posts %}\n{% endresult now %}' }))).toEqual(
      ['{% result %} takes no arguments', '{% endresult %} takes no arguments'].map(
        (detail, index) => `Line ${4 + index}: ${detail}`,
      ),
    );
    expect(issuesIn(pageOf({ body: '{% result %}\n{% lately %}{% endlately %}\n{% endresult %}' }))).toEqual([
      'Line 5: Put each block at the top level, outside other blocks and tags',
    ]);
  });
});

describe('the templates of a page', () => {
  it('are closed, and refused where a tag cannot be read', () => {
    expect(issuesIn(pageOf({ body: '{% result %}\n{{ output.date }}' }))).toEqual([
      'Line 4: {% result %} is never closed by {% endresult %}',
    ]);
    expect(issuesIn(pageOf({ body: '{% result %}\n{{ output.date' }))).toHaveLength(1);
  });

  it('take at most 32 KiB together, in UTF-8', () => {
    const filling = 'é'.repeat(16_385);

    expect(issuesIn(pageOf({ body: `{% result %}${filling}{% endresult %}` }))).toEqual([
      "Line 4: The templates take 32770 bytes in UTF-8, more than the 32768 a page's templates may take together",
    ]);
  });

  it('pair lately with data, since the views are kept for lately alone', () => {
    const words =
      'lately renders the views that data keeps, so a page with {% lately %} has data, and a page with data has {% lately %}';

    expect(issuesIn(pageOf({ body: latelyOfTheDays }))).toEqual([`Line 4: ${words}`]);
    expect(issuesIn(pageOf({ data: pageData() }))).toEqual([`Line 4, /data: ${words}`]);
  });

  it('leave result out of the playbook’s page, since the playbook has no runs of its own', () => {
    expect(issuesIn(pageOf({ of: 'playbook' }))).toEqual([
      'Line 4: The playbook has no runs of its own, so its page has no {% result %}',
    ]);
  });
});
