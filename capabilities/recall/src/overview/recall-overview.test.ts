import { readFileSync } from 'node:fs';

import { sectionIn } from '@on.auto/definitions/testing';
import { describe, expect, it } from 'vitest';

import { foldOf, recallDocument } from '../testing/campaign-reviews.ts';
import { recallWith } from '../testing/recall-runs.ts';

const page = readFileSync(new URL('../../../../docs/reference/recall-format.md', import.meta.url), 'utf8');

const [reviewsExample = '', announcementsExample = ''] = [...page.matchAll(/```markdown\n([\s\S]*?)```/gu)].map(
  ([, body = '']: readonly string[]) => body,
);

const twoFilters = [
  'language: typescript',
  'source:',
  '  events:',
  '    - { type: run_succeeded, subject: reasoning/review-brief }',
  '    - { type: run_rejected, subject: reasoning/review-brief }',
];

function goldenOf(file: string): string {
  return readFileSync(new URL(file, import.meta.url), 'utf8');
}

function overviewOf(frontMatter: readonly string[], answer?: string): string {
  const source = recallDocument(foldOf('return view;', answer), frontMatter.join('\n'));
  return recallWith().prepared(source).overview('reviews');
}

function rememberedOf(...filters: readonly string[]): readonly string[] {
  const events = filters.map((filter) => `    - ${filter}`);
  const remembered = sectionIn(
    overviewOf(['language: typescript', 'source:', '  events:', ...events]),
    'What it remembers',
  );
  return remembered
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2));
}

function initialOf(initial: string): string {
  return sectionIn(overviewOf([...twoFilters, 'view:', `  initial: ${initial}`]), 'What it keeps');
}

describe('the overviews of the examples of the reference of recall functions', () => {
  it('are, byte for byte, the overviews pinned beside this test', () => {
    const { prepared } = recallWith();

    expect(prepared(reviewsExample).overview('campaign-reviews')).toBe(goldenOf('reference-example.overview.md'));
    expect(prepared(announcementsExample).overview('announcements')).toBe(
      goldenOf('reference-common-case.overview.md'),
    );
  });
});

describe('the events a recall function remembers, in its overview', () => {
  it('say each filter after each time, in the words of an event filter, with each attribute it names', () => {
    expect(
      rememberedOf(
        '{ type: run_succeeded, subject: reasoning/review-brief, caller: acme-admin }',
        '{ type: definition_retired, source: /definitions/workflow/greet }',
        "{ type: order_placed, data: '${ $data.revenue > 100 }' }",
      ),
    ).toEqual([
      'each time a run of the reasoning function **review-brief** succeeds, when the caller is `acme-admin`',
      'each time the workflow **greet** is retired',
      'each time an event `order_placed` is published to the playbook, when `$data.revenue > 100` holds for its data',
    ]);
  });
});

describe('how the view of a recall function is kept, in its overview', () => {
  it('is a diagram from each filter to the view, drawn as a cylinder, and from the view to the answer', () => {
    const overview = overviewOf(twoFilters, 'return view;');

    expect(sectionIn(overview, 'How it is kept').split('\n\n')[0]).toBe(
      [
        '```mermaid',
        'flowchart LR',
        '  n1["A run of the reasoning function review-brief succeeds"]',
        '  n2["A run of the reasoning function review-brief is rejected"]',
        '  n3[("The view")]',
        '  n4["The answer of a run"]',
        '  n1 --> n3',
        '  n2 --> n3',
        '  n3 --> n4',
        '```',
      ].join('\n'),
    );
    expect(sectionIn(overview, 'What it remembers')).toMatch(
      /\n\nIt remembers an event that matches more than one of these once\.$/u,
    );
  });
});

describe('what a recall function keeps and answers, in its overview', () => {
  it('says the view it starts with, unless it starts empty', () => {
    expect(initialOf('{ count: 0 }')).toMatch(/\n\nBefore the first event, the view is `\{"count":0\}`\.$/u);
    expect(initialOf('0')).toMatch(/\n\nBefore the first event, the view is `0`\.$/u);
    expect(initialOf(`'${'x'.repeat(300)}'`)).toMatch(
      /\n\nBefore the first event, the view is the value of `view\.initial`, shown under Source\.$/u,
    );
    expect(['{}', '[]', "''", 'null'].map((initial) => initialOf(initial))).toEqual(
      ['{}', '[]', "''", 'null'].map(() =>
        [
          'It keeps one view, which its program updates with each event it remembers:',
          'Any value, which its document does not describe.',
        ].join('\n\n'),
      ),
    );
  });

  it('says a function without an answer answers with its view, and the schema its view is checked against', () => {
    const answered = ['Each run takes:', 'Any input, which its document does not describe.'];

    expect(sectionIn(overviewOf(twoFilters), 'What it answers')).toBe(
      [...answered, 'It answers with the view itself, as it stands.'].join('\n\n'),
    );
    expect(sectionIn(overviewOf([...twoFilters, 'output:', '  schema: { type: object }']), 'What it answers')).toBe(
      [...answered, 'It answers with the view itself, as it stands.', 'A record.'].join('\n\n'),
    );
  });

  it('says what a function with an answer but no schemas takes and answers', () => {
    expect(sectionIn(overviewOf(twoFilters, 'return view;'), 'What it answers')).toBe(
      [
        'Each run takes:',
        'Any input, which its document does not describe.',
        'It answers with what its program makes of the view and that input:',
        'Any output, which its document does not describe.',
      ].join('\n\n'),
    );
  });
});

describe('the view a recall function starts with, in its overview', () => {
  it('is said within 300 characters and named under Source at 301, a character beyond the Basic Multilingual Plane counted once', () => {
    const underSource = 'Before the first event, the view is the value of `view.initial`, shown under Source.';

    expect(
      [`'${'x'.repeat(298)}'`, `'${'x'.repeat(299)}'`, `'${'😀'.repeat(298)}'`, `'${'😀'.repeat(299)}'`].map(
        (initial) => initialOf(initial).split('\n\n').at(-1),
      ),
    ).toEqual([
      `Before the first event, the view is \`"${'x'.repeat(298)}"\`.`,
      underSource,
      `Before the first event, the view is \`"${'😀'.repeat(298)}"\`.`,
      underSource,
    ]);
  });
});
