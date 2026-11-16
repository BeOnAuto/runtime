import { describe, expect, it } from 'vitest';

import { forTheAgent } from './agent-rendition.ts';

function page(...lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}

describe('a page that marks nothing', () => {
  it('is served as the site has it, without the markup of the site and nothing else left out', () => {
    expect(
      forTheAgent(
        'reference/example.md',
        page(
          '---',
          'description: An example',
          '---',
          '',
          '<div v-pre>',
          '',
          '# Example',
          '',
          'A sentence.',
          '',
          '</div>',
        ),
      ),
    ).toBe(page('# Example', '', 'A sentence.'));
  });
});

describe('a marked passage', () => {
  it('is left out whole, with its element and the blank line after it, whoever it is marked for', () => {
    expect(
      forTheAgent(
        'reference/example.md',
        page(
          '<div v-pre>',
          '',
          '# Example',
          '',
          'For everyone.',
          '',
          '<div data-audience="operator">',
          '',
          'For whoever runs the server.',
          '',
          '| Setting | Range |',
          '| ------- | ----- |',
          '| `MOST`  | 1 to 9 |',
          '',
          '<!-- prettier-ignore -->',
          '```yaml',
          'most: 9',
          '```',
          '',
          '</div>',
          '',
          'For everyone again.',
          '',
          '<div data-audience="developer user">',
          '',
          '- For a developer',
          '- and a person in Studio',
          '',
          '</div>',
          '',
          '</div>',
        ),
      ),
    ).toBe(page('# Example', '', 'For everyone.', '', 'For everyone again.'));
  });
});

describe('a marked passage at either end of a page', () => {
  it('may open the page and may close it', () => {
    expect(
      forTheAgent(
        'reference/example.md',
        page('<div data-audience="user">', '', 'First.', '', '</div>', '', '# Example', '', 'Then.'),
      ),
    ).toBe(page('# Example', '', 'Then.'));
    expect(
      forTheAgent(
        'reference/example.md',
        page('# Example', '', 'Before.', '', '<div data-audience="user">', '', 'Last.', '', '</div>'),
      ),
    ).toBe(page('# Example', '', 'Before.'));
  });
});

describe('a marked clause in a sentence', () => {
  it('is left out of its sentence, with any code, link or emphasis it holds', () => {
    expect(
      forTheAgent(
        'reference/example.md',
        page(
          '# Example',
          '',
          'A model is named after its gateway<span data-audience="operator">, one of `MODEL_GATEWAYS`</span>, then the model.',
          'It runs<span data-audience="developer"> as [the HTTP reference](http.md) and **its route** say</span>.<br>Then it ends<span data-audience="operator user"> here</span>.',
        ),
      ),
    ).toBe(page('# Example', '', 'A model is named after its gateway, then the model.', 'It runs.<br>Then it ends.'));
  });
});

describe('a marked clause in a table', () => {
  it('is left out of a table cell, in part or whole, in a row that also holds an escaped bar', () => {
    expect(
      forTheAgent(
        'reference/example.md',
        page(
          '# Example',
          '',
          '| Bound     | Limit                                                     | Setting                                              |',
          '| --------- | --------------------------------------------------------- | ---------------------------------------------------- |',
          '| One image | 20 MiB<span data-audience="operator">, unless set</span> | <span data-audience="operator">`MOST_IMAGE`</span> |',
          '| `a \\| b` | 2 | <span data-audience="operator">`MOST_B`</span>           |',
          '| Short     | 3                                                         |',
        ),
      ),
    ).toBe(
      page(
        '# Example',
        '',
        '| Bound | Limit | Setting |',
        '| --- | --- | --- |',
        '| One image | 20 MiB | |',
        '| `a \\| b` | 2 | |',
        '| Short | 3 |',
      ),
    );
  });
});

describe('a marked clause in a list', () => {
  it('is left out of a list item, on its first line or a later one, in a tight, loose or nested list', () => {
    expect(
      forTheAgent(
        'reference/example.md',
        page(
          '# Example',
          '',
          '- One<span data-audience="operator">, for the operator</span>;',
          '  two<span data-audience="developer">, for a developer</span>;',
          '- Three',
          '  - Four<span data-audience="user">, for a person</span>.',
          '    Five.',
          '',
          '1. Six',
          '',
          '\tseven<span data-audience="operator"> and more</span>.',
        ),
      ),
    ).toBe(
      page('# Example', '', '- One;', '  two;', '- Three', '  - Four.', '    Five.', '', '1. Six', '', '\tseven.'),
    );
  });
});

describe('code on a page', () => {
  it('is served as written, a marking it shows in a sentence included, and HTML in it never read as a marking', () => {
    const shown = page(
      '# Example',
      '',
      'Write `<span data-audience="operator">` around a clause.',
      '',
      '```markdown',
      '<div v-pre>',
      '</div>',
      '```',
    );

    expect(forTheAgent('reference/example.md', shown)).toBe(shown);
  });
});
