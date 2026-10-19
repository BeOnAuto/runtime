import { describe, expect, it } from 'vitest';

import { writtenTextIssues } from '../document.ts';

type Finding = readonly [number, 'heading' | 'details' | 'fence' | 'html'];

const literalHeader = { line: 1, column: 8 };

function kindOf(detail: string): Finding[1] {
  if (detail.includes('takes no heading')) {
    return 'heading';
  }
  if (detail.includes('leaves open the fence')) {
    return 'fence';
  }
  return detail.includes('leaves open the HTML block') ? 'html' : 'details';
}

function findingsOf(...lines: readonly string[]): readonly Finding[] {
  const source = ['about: |', ...lines.map((line) => `  ${line}`)];
  return writtenTextIssues(lines.join('\n'), 'about', { lines: source, firstLine: 1 }, literalHeader).map(
    ({ line, detail }): Finding => [line - 2, kindOf(detail)],
  );
}

describe('a fence in a text of a document', () => {
  it('opens indented three spaces after a line of a paragraph, and is a line of the paragraph indented four', () => {
    expect([findingsOf('Text', '   ```', '# Inside'), findingsOf('Text', '    ```', '# After it')]).toEqual([
      [[1, 'fence']],
      [[2, 'heading']],
    ]);
  });

  it('closes on a line of its marker indented at most three spaces, with only spaces or tabs after it', () => {
    expect([
      findingsOf('```', 'code', '   ```', '# After it'),
      findingsOf('```', 'code', '    ```', '# Inside'),
      findingsOf('```', 'code', '```\t ', '# After it'),
      findingsOf('```', 'code', '```\u00A0', '# Inside'),
    ]).toEqual([[[3, 'heading']], [[0, 'fence']], [[3, 'heading']], [[0, 'fence']]]);
  });

  it('of backticks takes no backtick after its marker, so a line that holds one is a line of a paragraph', () => {
    expect([findingsOf('``` a`b', '# After it', '```'), findingsOf('~~~ a`b', '# Inside', '~~~')]).toEqual([
      [
        [1, 'heading'],
        [2, 'fence'],
      ],
      [],
    ]);
  });
});

describe('a fence in a list item of a text of a document', () => {
  it('ends with the item, at the first line indented less than its content', () => {
    expect([
      findingsOf('Text', '    ```', '## Details'),
      findingsOf('- item', '  ```', '## Details'),
      findingsOf('- item', '  ```', '## Details', '  ```'),
      findingsOf('- item', '  ```', '## After it'),
      findingsOf('- item', '', '  ```', '  # Inside', '  ```', '# After it'),
    ]).toEqual([
      [[2, 'details']],
      [[2, 'details']],
      [
        [2, 'details'],
        [3, 'fence'],
      ],
      [[2, 'heading']],
      [[5, 'heading']],
    ]);
  });

  it('is in no list item that starts empty when a blank line follows its marker, which ends the item', () => {
    expect([
      findingsOf('1.', '', '   ```', '  ```', '# After it'),
      findingsOf('-', '  ```', '  # Inside', '  ```', '# After it'),
    ]).toEqual([[[4, 'heading']], [[4, 'heading']]]);
  });
});

describe('a block a text of a document leaves open', () => {
  it('is refused at the line that opens it, a fence of backticks or of tildes', () => {
    expect([findingsOf('Intro.', '```ts', 'code'), findingsOf('~~~', 'code', '```')]).toEqual([
      [[1, 'fence']],
      [[0, 'fence']],
    ]);
  });

  it('is refused at the line that opens it, an HTML block that ends at a closing tag of its raw kind', () => {
    expect(['<pre>', '<script>', '<style>', '<textarea>'].map((opener) => findingsOf(opener, 'text'))).toEqual([
      [[0, 'html']],
      [[0, 'html']],
      [[0, 'html']],
      [[0, 'html']],
    ]);
  });

  it('is refused at the line that opens it, a comment, a processing instruction, a declaration or a CDATA section', () => {
    expect(
      ['<!-- note', '<?php', '<!DOCTYPE html', '<![CDATA['].map((opener) => findingsOf('Intro.', '', opener, 'text')),
    ).toEqual([[[2, 'html']], [[2, 'html']], [[2, 'html']], [[2, 'html']]]);
  });

  it('is none that the blank line after the text ends: an element, a tag alone on its line, a block in a list item', () => {
    expect([
      findingsOf('<div>', 'text'),
      findingsOf('<span>', 'text'),
      findingsOf('- item', '  ```', '  code'),
    ]).toEqual([[], [], []]);
  });
});

describe('the line of an overview of its own in a text of a document', () => {
  it('is ## Details, refused wherever it is, in a fence too, and no other line that names Details', () => {
    expect(findingsOf('## Details', '```', '## Details', '```', '### Details', '## Details ', 'Details')).toEqual([
      [0, 'details'],
      [2, 'details'],
      [4, 'heading'],
      [5, 'heading'],
    ]);
  });

  it('says that the page that shows an overview splits it at that text', () => {
    expect(findingsOf('## Details').length).toBe(1);
    expect(
      writtenTextIssues('## Details', 'about', { lines: ['about: |', '  ## Details'], firstLine: 1 }, literalHeader),
    ).toEqual([
      {
        line: 2,
        column: 3,
        detail:
          "about may not hold the line ## Details, which is the overview's own, since the page that shows an overview splits it at that text: this line is one",
      },
    ]);
  });
});

describe('the indentation of a line of a text of a document', () => {
  it('is its spaces and tabs alone, so a no-break or an ideographic space before a heading line makes none', () => {
    expect([findingsOf('\u00A0# Words'), findingsOf('\u3000# Words'), findingsOf('   # Words')]).toEqual([
      [],
      [],
      [[0, 'heading']],
    ]);
  });

  it('is its spaces and tabs alone, so a no-break or an ideographic space before a fence opens none', () => {
    expect([
      findingsOf('Text', '', '\u00A0```', '# After it', '```'),
      findingsOf('Text', '', '\u3000```', '# After it', '```'),
    ]).toEqual([
      [
        [3, 'heading'],
        [4, 'fence'],
      ],
      [
        [3, 'heading'],
        [4, 'fence'],
      ],
    ]);
  });
});
