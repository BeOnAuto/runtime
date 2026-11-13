import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { servedWithCards, servedWithInteraction } from '../testing/guide-shelves.ts';
import { withLinksResolved } from './page-links.ts';
import { withoutSiteMarkup } from './site-markup.ts';

function page(path: string): string {
  return readFileSync(new URL(`../../../../docs/${path}`, import.meta.url), 'utf8');
}

describe('the guides of a server that serves an interaction function with a companion guide', () => {
  it('carry the companion right after the format guide of its type, made of its page', () => {
    const names = servedWithCards.guides.map(({ name }) => name);

    expect(names.slice(names.indexOf('interaction-function'), names.indexOf('interaction-function') + 2)).toEqual([
      'interaction-function',
      'render-slack',
    ]);
    expect(servedWithCards.named('render-slack')).toEqual({
      name: 'render-slack',
      title: 'Cards for Slack',
      description: 'How to write a message to Slack as a card.',
      text: withLinksResolved(withoutSiteMarkup(page('reference/render-slack.md')), 'reference/render-slack.md'),
    });
    expect(servedWithCards.named('render-slack')?.text.startsWith('# Cards for Slack')).toBe(true);
  });

  it('carry none where the type serves none', () => {
    expect(servedWithInteraction.named('render-slack')).toBeUndefined();
  });
});
