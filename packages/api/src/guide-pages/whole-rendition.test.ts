import type { GuideVariables } from '@on.auto/definitions';
import { describe, expect, it } from 'vitest';

import { forTheAgent } from './agent-rendition.ts';

const nothingDeclared: GuideVariables = {};

function page(...lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}

function refusalOf(...lines: readonly string[]): string {
  try {
    forTheAgent('reference/example.md', page(...lines), nothingDeclared);
  } catch (error: unknown) {
    return String(error);
  }
  return 'served';
}

describe('what is left for the agent once marked passages are out', () => {
  it('is refused when it is empty, a heading has nothing under it, or a table has no rows', () => {
    expect([
      refusalOf('<div data-audience="user">', '', 'All of it.', '', '</div>'),
      refusalOf('# A', '', '## B', '', '<div data-audience="user">', '', 'C.', '', '</div>', '', '## D', '', 'E.'),
      refusalOf('# A', '', 'B.', '', '## C', '', '<div data-audience="user">', '', 'D.', '', '</div>'),
      refusalOf(
        '# A',
        '',
        '| B | C |',
        '| - | - |',
        '| <span data-audience="user">d</span> | <span data-audience="user">e</span> |',
      ),
    ]).toEqual([
      'Error: The page reference/example.md cannot be served as a guide. The guide is empty.',
      'Error: The page reference/example.md cannot be served as a guide. The heading "B" has nothing under it.',
      'Error: The page reference/example.md cannot be served as a guide. The heading "C" has nothing under it.',
      'Error: The page reference/example.md cannot be served as a guide. The table headed "B | C" has no rows.',
    ]);
  });

  it('is refused when a sentence, a table cell or a list item is left as punctuation or nothing', () => {
    expect([
      refusalOf('# A', '', '<span data-audience="user">Only a person does it</span>.'),
      refusalOf('# A', '', '| B | C |', '| - | - |', '| d | <span data-audience="user">e</span>; |'),
      refusalOf('# A', '', '- <span data-audience="user">All of it</span>', '- B'),
    ]).toEqual([
      'Error: The page reference/example.md cannot be served as a guide. The passage "." is only punctuation.',
      'Error: The page reference/example.md cannot be served as a guide. The passage ";" is only punctuation.',
      'Error: The page reference/example.md cannot be served as a guide. A list item is empty.',
    ]);
  });
});
