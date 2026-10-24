import { describe, expect, it } from 'vitest';

import { withoutSiteMarkup } from './site-markup.ts';

const page = [
  '<div v-pre>',
  '',
  '# Recall function format',
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
        '# Recall function format',
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
