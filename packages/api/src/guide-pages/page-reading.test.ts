import { describe, expect, it } from 'vitest';

import { forTheAgent, markingFaultsOf } from './agent-rendition.ts';

function page(...lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}

function faultsOf(...lines: readonly string[]): readonly string[] {
  return markingFaultsOf(page(...lines));
}

function refusalOf(...lines: readonly string[]): string {
  try {
    forTheAgent('reference/example.md', page(...lines));
  } catch (error: unknown) {
    return String(error);
  }
  return 'served';
}

describe('a marked passage a guide cannot read', () => {
  it('names an audience the pages do not use, or one twice, or none', () => {
    expect([
      ...faultsOf('<div data-audience="admin">', '', 'A.', '', '</div>'),
      ...faultsOf('A<span data-audience="operator operator"> b</span>.'),
      ...faultsOf('A<span data-audience=""> b</span>.'),
    ]).toEqual([
      'The line "<div data-audience="admin">" names no audience a page may name in data-audience="admin": name one or more of operator, developer, user, each once and separated by one space.',
      'The line "A<span data-audience="operator operator"> b</span>." names no audience a page may name in data-audience="operator operator": name one or more of operator, developer, user, each once and separated by one space.',
      'The line "A<span data-audience=""> b</span>." names no audience a page may name in data-audience="": name one or more of operator, developer, user, each once and separated by one space.',
    ]);
  });

  it('opens a passage it never closes, or one inside another, or holds HTML or a clause marked inside it', () => {
    expect([
      ...faultsOf('# A', '', '<div data-audience="user">', '', 'B.'),
      ...faultsOf(
        '<div data-audience="user">',
        '',
        '<div data-audience="operator">',
        '',
        'B<span data-audience="developer"> c</span>.',
        '',
        '<div class="note">',
        '',
        '</div>',
      ),
    ]).toEqual([
      'The line "<div data-audience="user">" opens a marked passage and never closes it with a line that is </div>.',
      'The line "<div data-audience="operator">" opens a marked passage inside another.',
      'The line "B<span data-audience="developer"> c</span>." holds HTML or another marking inside a marked passage.',
      'The line "<div class="note">" holds HTML or another marking inside a marked passage.',
    ]);
  });

  it('writes a passage whose lines are not set apart by blank lines, or whose text shares its element', () => {
    expect([
      ...faultsOf('Before.', '<div data-audience="user">', '', 'B.', '', '</div>'),
      ...faultsOf('<div data-audience="user">', '', 'B.', '</div>'),
      ...faultsOf('<div data-audience="user">', 'B.', '</div>'),
      ...faultsOf('<div data-variable="generation.most_image">', '', 'B.', '', '</div>'),
    ]).toEqual([
      'The line "<div data-audience="user">" writes a marked passage whose opening line is not set apart by blank lines.',
      'The line "</div>" writes a marked passage whose closing line is not set apart by blank lines.',
      'The line "<div data-audience="user">" writes a marking in a form a page may not use: a passage opens with <div data-audience="…"> alone on its line, and a clause is wrapped in <span data-audience="…">.',
      'The line "<div data-variable="generation.most_image">" writes a marking in a form a page may not use: a passage opens with <div data-audience="…"> alone on its line, and a clause is wrapped in <span data-audience="…">.',
    ]);
  });
});

describe('a marked clause a guide cannot read', () => {
  it('marks a clause over two lines, leaves it open, or holds HTML or another clause inside it', () => {
    expect([
      ...faultsOf('A<span data-audience="user"> b', 'c</span>.'),
      ...faultsOf('A<span data-audience="user"> b.'),
      ...faultsOf('A<span data-audience="user"> b<br>c</span>.'),
      ...faultsOf('A<span data-audience="user"> b <span data-audience="operator">c</span></span>.'),
      ...faultsOf('A<span data-audience="user"> **b <span data-audience="operator">c</span>**</span>.'),
      ...faultsOf('A <span data-variable="generation.most_image">20 MiB</span>.'),
    ]).toEqual([
      'The line "A<span data-audience="user"> b" runs a marked span over more than one line.',
      'The line "A<span data-audience="user"> b." opens a marked span and does not close it on the same line.',
      'The line "A<span data-audience="user"> b<br>c</span>." holds HTML or another marking inside a marked span.',
      'The line "A<span data-audience="user"> b <span data-audience="operator">c</span></span>." holds HTML or another marking inside a marked span.',
      'The line "A<span data-audience="user"> **b <span data-audience="operator">c</span>**</span…" holds HTML or another marking inside a marked span.',
      'The line "A <span data-variable="generation.most_image">20 MiB</span>." writes a marking in a form a page may not use: a passage opens with <div data-audience="…"> alone on its line, and a clause is wrapped in <span data-audience="…">.',
    ]);
  });

  it('marks a clause inside emphasis, a link, a heading or a quotation', () => {
    expect([
      ...faultsOf('A **b<span data-audience="user"> c</span>**.'),
      ...faultsOf('A [b<span data-audience="user"> c</span>](b.md).'),
      ...faultsOf('# A<span data-audience="user"> b</span>'),
      ...faultsOf('> A<span data-audience="user"> b</span>.'),
    ]).toEqual([
      'The line "A **b<span data-audience="user"> c</span>**." marks a passage inside emphasis or a link, where a guide does not read it.',
      'The line "A [b<span data-audience="user"> c</span>](b.md)." marks a passage inside emphasis or a link, where a guide does not read it.',
      'The line "# A<span data-audience="user"> b</span>" marks a passage inside a heading, where a guide does not read it: mark a paragraph, a list item or a table cell.',
      'The line "> A<span data-audience="user"> b</span>." marks a passage inside a blockquote, where a guide does not read it: mark a paragraph, a list item or a table cell.',
    ]);
  });
});

describe('a marking a guide cannot place', () => {
  it('writes a marking inside a code example, or where the parser reads it as text', () => {
    expect([
      ...faultsOf('# A', '', '```markdown', '<span data-audience="user">b</span>', '```'),
      ...faultsOf('A \\<span data-audience="user">b\\</span>.'),
      ...faultsOf('| A | B |', '| - | - |', '| a | b | <span data-audience="user">c</span> |'),
    ]).toEqual([
      'The line "```markdown" writes a marking inside a code example, which a guide shows as it is written.',
      'The line "A \\<span data-audience="user">b\\</span>." writes a marking where the Markdown parser reads it as text, not as an element.',
      'The line "| A | B |" writes a marking where the Markdown parser reads it as text, not as an element.',
    ]);
  });

  it('marks a table cell whose clause holds an escaped bar, which the parser reads without its backslash', () => {
    expect(faultsOf('| A |', '| - |', '| a <span data-audience="user">b \\| c</span> |')).toEqual([
      'The line "| a <span data-audience="user">b \\| c</span> |" holds a marking the Markdown parser does not place where it is written, so a guide cannot read it.',
    ]);
  });

  it('is in a page the parser cannot account for character by character', () => {
    expect(markingFaultsOf('# A\r\n\r\nB<span data-audience="user"> c</span>.\r\n')).toEqual([
      'The page cannot be read: the Markdown parser does not account for every character of it.',
    ]);
  });

  it('stops the page from being served, and the page is named', () => {
    expect(refusalOf('# A', '', 'B<span data-audience="admin"> c</span>.')).toBe(
      'Error: The page reference/example.md cannot be served as a guide. The line "B<span data-audience="admin"> c</span>." names no audience a page may name in data-audience="admin": name one or more of operator, developer, user, each once and separated by one space.',
    );
  });
});
