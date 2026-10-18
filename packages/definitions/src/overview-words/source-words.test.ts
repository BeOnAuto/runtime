import { describe, expect, it } from 'vitest';

import { markdownOf, shownUnderSource, type Paragraph } from '../index.ts';

function writtenOf(said: Paragraph): string | undefined {
  return markdownOf({ title: 'fold', opening: ['Folds'], body: [said], sections: [], appendix: [] })
    .split('\n\n')
    .at(-1);
}

describe('the words of what is shown under Source', () => {
  it('say that a program is TypeScript and is shown there, or that a value is, after the words that name it', () => {
    expect([
      writtenOf(shownUnderSource('program', 'The program')),
      writtenOf(shownUnderSource('program', 'The program, its ', { code: 'fold' }, ',')),
      writtenOf(
        shownUnderSource('value', 'Before the first event, the view is the value of ', { code: 'view.initial' }),
      ),
    ]).toEqual([
      'The program is TypeScript and is shown under Source.\n',
      'The program, its `fold`, is TypeScript and is shown under Source.\n',
      'Before the first event, the view is the value of `view.initial`, shown under Source.\n',
    ]);
  });
});
