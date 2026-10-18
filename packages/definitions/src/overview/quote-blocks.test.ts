import { describe, expect, it } from 'vitest';

import { markdownOf, named, sectionOf, type Phrases } from '../index.ts';

function quoted(...lines: readonly Phrases[]): string {
  return String(
    markdownOf({
      title: 'quote',
      opening: [],
      body: [],
      sections: [sectionOf('What it sends', { kind: 'quote', lines })],
      appendix: [],
    }).split('## What it sends\n\n')[1],
  );
}

function quotedLines(...lines: readonly string[]): string {
  return quoted(...lines.map((line) => [line]));
}

function firstLineBefore(line: string): string | undefined {
  return quoted(['Lead'], [line]).split('\n')[0];
}

describe('a quote of an overview', () => {
  it('is a block quote, with a hard break between two lines of one paragraph and none on its last line', () => {
    expect(
      quoted(['Here is the draft for ', named('owner'), ':'], [named('draft')], [], ['Reply ', named('approve')]),
    ).toBe('> Here is the draft for **owner**:\\\n> **draft**\n>\n> Reply **approve**\n');
  });

  it('writes a list item as its first line, with a hard break before a line that goes on with it, and each line of a phrase apart', () => {
    expect(quoted(['- first\n  goes on'], ['- second'])).toBe('> - first\\\n>   goes on\n> - second\n');
  });

  it('writes a hard break before a line indented under a line of a paragraph, which goes on with it', () => {
    expect(quotedLines('Lead', '    goes on')).toBe('> Lead\\\n>     goes on\n');
  });
});

describe('the lines a quote writes no hard break before', () => {
  it('open a list item, a quote, a heading, a fence, a table, a thematic break or a setext underline, however indented', () => {
    const openers = [
      ['- item', '2. item', '> quoted', '## Heading', '```', '| a | b |\n| --- | --- |', '***', '===', '---'],
      ['    - item', '      > quoted', '    ## Heading', '    ```', '    ***'],
    ].flat();

    expect(openers.map((line) => firstLineBefore(line))).toEqual(openers.map(() => '> Lead'));
  });

  it('are the items of a list nested two deep, and an item nested four spaces in', () => {
    expect([quotedLines('- a', '  - b', '    - c'), quotedLines('- one', '    - two')]).toEqual([
      '> - a\n>   - b\n>     - c\n',
      '> - one\n>     - two\n',
    ]);
  });

  it('are the lines of a fence inside a nested item', () => {
    expect(quotedLines('- a', '  - b', '    ```', '    code line', '    more code', '    ```')).toBe(
      ['> - a', '>   - b', '>     ```', '>     code line', '>     more code', '>     ```', ''].join('\n'),
    );
  });
});

describe('the lines of a quote that are not lines of a paragraph', () => {
  it('take no hard break: a line that stands alone, the lines of a fence or of indented code, and one ending with a backslash', () => {
    expect(
      quotedLines(
        '# Heading',
        'text after it',
        '```',
        'code',
        'more code',
        '```',
        '',
        '    indented code',
        '    more of it',
        '',
        'ends with \\',
        'next',
      ),
    ).toBe(
      [
        '> # Heading',
        '> text after it',
        '> ```',
        '> code',
        '> more code',
        '> ```',
        '>',
        '>     indented code',
        '>     more of it',
        '>',
        '> ends with \\',
        '> next',
        '',
      ].join('\n'),
    );
  });

  it('keep a fence open until a line of the same marker, at least as long, closes it', () => {
    expect(quotedLines('~~~~', '```', '~~~', 'still code', '~~~~ ', 'after', 'it')).toBe(
      ['> ~~~~', '> ```', '> ~~~', '> still code', '> ~~~~ ', '> after\\', '> it', ''].join('\n'),
    );
  });

  it('are indented code after a heading, a closing fence or a thematic break', () => {
    const lines = ['## Heading', '    code', '    more', '```', 'x', '```', '    code', '    more', '***'];

    expect(quotedLines(...lines, '    code', '    more')).toBe(
      `${[...lines, '    code', '    more'].map((line) => `> ${line}`).join('\n')}\n`,
    );
  });
});

describe('the tables of a quote', () => {
  it('run from a header row and its delimiter row to the next blank line, and take no hard break', () => {
    expect(quotedLines('Lead', '| a | b |', '| --- | :-: |', '| 1 | 2 |', 'a | b', '', 'After', 'it')).toBe(
      ['> Lead', '> | a | b |', '> | --- | :-: |', '> | 1 | 2 |', '> a | b', '>', '> After\\', '> it', ''].join('\n'),
    );
  });

  it('leave a line with a pipe that heads no table a line of its paragraph', () => {
    expect([quotedLines('Costs a | b', 'and more'), quotedLines('Lead', 'a | b'), quotedLines('a | b', '| x')]).toEqual(
      ['> Costs a | b\\\n> and more\n', '> Lead\\\n> a | b\n', '> a | b\\\n> | x\n'],
    );
  });
});

describe('the HTML blocks of a quote', () => {
  it('stand alone when they open with a block of each of the six kinds that may interrupt a paragraph', () => {
    const openers = ['<pre>', '<!-- note', '<?php', '<!DOCTYPE html', '<![CDATA[', '<div class="note">', '</p>'];

    expect([...openers.map((line) => firstLineBefore(line)), firstLineBefore('<span>')]).toEqual([
      ...openers.map(() => '> Lead'),
      '> Lead\\',
    ]);
  });

  it('take no hard break until they end, at a blank line or at the end their kind names', () => {
    expect([
      quotedLines('<div>', 'inside', 'still', '', 'after', 'it'),
      quotedLines('<!-- a', 'b -->', 'after', 'it'),
      quotedLines('<!-- a', 'b --!>', 'after', 'it'),
      quotedLines('<script>run()</script>', 'after', 'it'),
    ]).toEqual([
      ['> <div>', '> inside', '> still', '>', '> after\\', '> it', ''].join('\n'),
      ['> <!-- a', '> b -->', '> after\\', '> it', ''].join('\n'),
      ['> <!-- a', '> b --!>', '> after\\', '> it', ''].join('\n'),
      ['> <script>run()</script>', '> after\\', '> it', ''].join('\n'),
    ]);
  });
});
