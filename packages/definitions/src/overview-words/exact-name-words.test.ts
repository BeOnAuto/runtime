import { describe, expect, it } from 'vitest';

import { bulletList, markdownOf, sectionOf, type NamedDefinition } from '../index.ts';
import { exactNameWithType } from './exact-name-words.ts';

describe('the exact name of a definition with its type', () => {
  it('is its name as written, in code, then its type after an article, as the appendix lists it', () => {
    const definitions: readonly NamedDefinition[] = [
      { type: 'interaction', name: 'approve-version' },
      { type: 'workflow', name: 'weekly_review' },
      { type: 'echo', name: 'greets' },
    ];
    const names = bulletList(definitions.map((definition) => exactNameWithType(definition)));

    expect(
      markdownOf({
        title: 'plain',
        opening: ['Plain'],
        body: [],
        sections: [],
        appendix: [sectionOf('Used by', names)],
      }),
    ).toBe(
      '# plain\n\nPlain\n\n## Details\n\n### Used by\n\n- `approve-version`, an interaction function\n- `weekly_review`, a workflow\n- `greets`, an echo definition\n',
    );
  });
});
