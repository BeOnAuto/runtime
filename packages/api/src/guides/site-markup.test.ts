import { describe, expect, it } from 'vitest';

import { withoutSiteMarkup } from './site-markup.ts';

const page = [
  '<div v-pre>',
  '',
  '# Page format',
  '',
  'This example keeps the reviews:',
  '',
  '<!-- prettier-ignore -->',
  '```markdown',
  '<!-- prettier-ignore -->',
  '<div v-pre>',
  '</div>',
  '```',
  '',
  'The end.',
  '',
  '</div>',
  '',
].join('\n');

describe('a page served as a guide', () => {
  it('loses the wrapper and the formatter lines the documentation site needs, and keeps its code as written', () => {
    expect(withoutSiteMarkup(page)).toBe(
      [
        '# Page format',
        '',
        'This example keeps the reviews:',
        '',
        '```markdown',
        '<!-- prettier-ignore -->',
        '<div v-pre>',
        '</div>',
        '```',
        '',
        'The end.',
        '',
      ].join('\n'),
    );
  });

  it('keeps a page without them as it is', () => {
    expect(withoutSiteMarkup('# Workflow format\n\nA workflow runs steps.\n')).toBe(
      '# Workflow format\n\nA workflow runs steps.\n',
    );
  });
});

describe('the front matter of a page served as a guide', () => {
  it('is left out with the wrapper after it, since it holds the title and the description only the documentation site reads', () => {
    const described = [
      '---',
      'title: Liquid templates and filters',
      'description: "The filters of a template: the standard ones, and those Auto Runtime adds."',
      '---',
      '',
      '<div v-pre>',
      '',
      '# Templates',
      '',
      'These are Liquid templates.',
      '',
      '</div>',
      '',
    ].join('\n');

    expect(withoutSiteMarkup(described)).toBe('# Templates\n\nThese are Liquid templates.\n');
  });

  it('is only what opens the page, so a rule of three dashes further down stays', () => {
    const ruled = '# Workflow format\n\nA workflow runs steps.\n\n---\n\nIts limits.\n\n---\n';

    expect(withoutSiteMarkup(ruled)).toBe('# Workflow format\n\nA workflow runs steps.\n\n---\n\nIts limits.\n\n---\n');
  });
});

describe('a table of a page served as a guide', () => {
  it('loses the padding that aligns the columns of its tables, outside its code', () => {
    const tables = [
      '| Field   | Meaning      |',
      '| ------- | ------------ |',
      '| `name`  | Its name     |',
      '',
      '```text',
      '| kept    | as written   |',
      '```',
      '',
    ].join('\n');

    expect(withoutSiteMarkup(tables)).toBe(
      [
        '| Field | Meaning |',
        '| --- | --- |',
        '| `name` | Its name |',
        '',
        '```text',
        '| kept    | as written   |',
        '```',
        '',
      ].join('\n'),
    );
  });
});
