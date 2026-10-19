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

interface Placed {
  readonly line: number;
  readonly column: number;
  readonly detail: string;
}

function placesOf(
  issues: readonly Placed[],
): readonly { readonly line: number; readonly column: number; readonly where: string | undefined }[] {
  return issues.map(({ line, column, detail }) => ({
    line,
    column,
    where: /: (?<where>the line that begins “.+”) makes one/u.exec(detail)?.groups?.['where'],
  }));
}

function aboutIssuesAt(line: number, text: string, lines: readonly string[]): readonly Placed[] {
  return writtenTextIssues(text, 'about', { lines, firstLine: line }, { line, column: 8 });
}

function headingsOf(...lines: readonly string[]): readonly number[] {
  return findingsOf(...lines)
    .filter(([, kind]) => kind === 'heading')
    .map(([index]) => index);
}

describe('a refusal of a text of a document', () => {
  it('is at the line of its own in a literal block, and at the column its text starts at, in words that name its key', () => {
    const source = ['---', 'description: |', '    Who it serves.', '', '    ## When it runs'];

    expect(
      writtenTextIssues(
        'Who it serves.\n\n## When it runs\n',
        'description',
        { lines: source, firstLine: 1 },
        { line: 2, column: 14 },
      ),
    ).toEqual([
      {
        line: 5,
        column: 5,
        detail:
          'description takes no heading, since an overview writes its own: this line makes one, with # before its words or as a line of = or - under the words above it',
      },
    ]);
  });

  it('is at the line and the column its value opens at in any other style, naming the line by its first words', () => {
    const folded = ['about: >', '  Intro.', '', '  ## Heading of the team'];
    const quoted = ['about: "Intro.\\n  ## Heading\\tof the brief"'];

    expect([
      placesOf(aboutIssuesAt(3, 'Intro.\n## Heading of the team\n', folded)),
      placesOf(aboutIssuesAt(7, 'Intro.\n  ## Heading\tof the brief', quoted)),
    ]).toEqual([
      [{ line: 3, column: 8, where: 'the line that begins “## Heading of the”' }],
      [{ line: 7, column: 8, where: 'the line that begins “## Heading of the”' }],
    ]);
  });

  it('reads a value on a line its source does not hold as one in no literal block', () => {
    expect(
      placesOf(writtenTextIssues('# Heading', 'about', { lines: [], firstLine: 1 }, { line: 4, column: 3 })),
    ).toEqual([{ line: 4, column: 3, where: 'the line that begins “# Heading”' }]);
  });
});

describe('a heading in a text of a document', () => {
  it('is a line of one to six # and a space, a tab or nothing, or a line of = or - under a line of a paragraph', () => {
    expect(headingsOf('# One', 'Text', '###### Six', '#\tTabbed', '#', 'Two', '===', 'Three', '---')).toEqual([
      0, 2, 3, 4, 6, 8,
    ]);
  });

  it('is indented at most three spaces after a line of a paragraph, as a heading line or as an underline', () => {
    expect([
      headingsOf('Text', '   # Three'),
      headingsOf('Text', '    # Four'),
      headingsOf('Text', '\t# Tabbed'),
      headingsOf('Text', '   ==='),
      headingsOf('Text', '    ==='),
    ]).toEqual([[1], [], [], [1], []]);
  });

  it('is none of a tag, seven #, an escaped #, a thematic break or a line of = after a blank line', () => {
    expect(findingsOf('#tag', '####### Seven', '\\# Escaped', '', '---', '', '===', '***', 'Text', '- - -')).toEqual(
      [],
    );
  });
});

describe('a heading in a container of a text of a document', () => {
  it('is in a quote, in a list item and in a list item of a quote, after the markers of each', () => {
    expect([
      headingsOf('> # Words'),
      headingsOf('- # Words'),
      headingsOf('1. ## Words'),
      headingsOf('> - # Words'),
    ]).toEqual([[0], [0], [0], [0]]);
  });

  it('is an underline in a quote under a line of the same quote, and one indented to the content of an item under it', () => {
    expect([
      headingsOf('> Title', '> ==='),
      headingsOf('- item', '  ---'),
      headingsOf('- a', '  - b', '    ==='),
    ]).toEqual([[1], [1], [2]]);
  });

  it('is no underline under a line that opens or lazily goes on with an item or a quote', () => {
    expect([
      findingsOf('- item', '---'),
      findingsOf('> quote', '==='),
      findingsOf('- item', 'goes on', '==='),
      findingsOf('> - item', '> ---'),
      findingsOf('> > deep', '> goes on', '> ==='),
    ]).toEqual([[], [], [], [], []]);
  });

  it('is in an item, indented to its content with spaces or a tab, and not in indented code of the item', () => {
    expect([
      headingsOf('- item', '', '    # In it'),
      headingsOf('- a', '  - b', '', '      # In b'),
      headingsOf('- item', '\t# In it'),
      headingsOf('-\t# Words'),
      headingsOf('-     # Code'),
      headingsOf('-', '  # In the item'),
      headingsOf('- item', '>', '    # Code'),
    ]).toEqual([[2], [3], [1], [0], [], [1], []]);
  });

  it('is an underline under a paragraph that an empty item or an ordered item not from 1 cannot interrupt', () => {
    expect([headingsOf('Text', '-'), headingsOf('Text', '2. two', '    ===')]).toEqual([[1], []]);
  });
});

describe('a heading in a block of a text of a document', () => {
  it('is none of a line in a fence, in indented code, in an HTML block or under a row of a table', () => {
    expect(
      findingsOf(
        '```',
        '# A comment of a shell',
        '```',
        '',
        '    # Code',
        '<div>',
        '# Inside',
        '</div>',
        '',
        '| a | b |',
        '| - | - |',
        '| 1 | 2 |',
        '---',
      ),
    ).toEqual([]);
  });

  it('is a line after an HTML block that ends on its line, and after a tag that interrupts a paragraph, and in no block of a tag alone on its line', () => {
    expect([
      headingsOf('<!-- a note -->', '# After it'),
      headingsOf('<pre>', '# Inside', '</pre>', '# After it'),
      headingsOf('<span>', '# Inside', '', '# After it'),
      headingsOf('Text', '<span>', '# After it'),
      headingsOf('<my-card size="2">', '# Inside'),
    ]).toEqual([[1], [3], [3], [2], []]);
  });
});
