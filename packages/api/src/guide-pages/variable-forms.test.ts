import type { GuideVariables } from '@on.auto/definitions';
import { describe, expect, it } from 'vitest';

import { defaultsTypedIn, forTheAgent, markingFaultsOf, withDefaultsWritten } from './agent-rendition.ts';

function page(...lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}

const onACloud: GuideVariables = {
  'example.most_image': { value: '8 MiB', default: '20 MiB' },
  'example.kept': { value: '30 days', default: '90 days' },
  'example.image_model': { value: 'auto/openai/gpt-image-2', default: 'gateway/openai/gpt-image-2' },
};

const asWritten: GuideVariables = {
  'example.most_image': { value: '20 MiB', default: '20 MiB' },
  'example.kept': { value: '90 days', default: '90 days' },
  'example.image_model': { value: 'gateway/openai/gpt-image-2', default: 'gateway/openai/gpt-image-2' },
};

const withValues = page(
  '# Example',
  '',
  'An image holds at most <span data-variable="example.most_image">20 MiB</span> and is kept <span data-variable="example.kept">90 days</span>.',
  '',
  '| Bound     | Limit                                                    |',
  '| --------- | -------------------------------------------------------- |',
  '| One image | <span data-variable="example.most_image">20 MiB</span> |',
  '',
  '- A model, such as <span data-variable="example.image_model">`gateway/openai/gpt-image-2`</span>.',
);

describe('a value a page names', () => {
  it('is written as the server has it, in a sentence, a table cell and a list item, as code where the page writes it as code', () => {
    expect(forTheAgent('reference/example.md', withValues, onACloud)).toBe(
      page(
        '# Example',
        '',
        'An image holds at most 8 MiB and is kept 30 days.',
        '',
        '| Bound | Limit |',
        '| --- | --- |',
        '| One image | 8 MiB |',
        '',
        '- A model, such as `auto/openai/gpt-image-2`.',
      ),
    );
  });

  it('is its default on a server that sets none, as the site shows it', () => {
    expect(forTheAgent('reference/example.md', withValues, asWritten)).toBe(
      page(
        '# Example',
        '',
        'An image holds at most 20 MiB and is kept 90 days.',
        '',
        '| Bound | Limit |',
        '| --- | --- |',
        '| One image | 20 MiB |',
        '',
        '- A model, such as `gateway/openai/gpt-image-2`.',
      ),
    );
  });
});

describe('a code example that declares the values it holds', () => {
  it('holds each as the server has it, wherever it stands in that example alone, and loses its element', () => {
    expect(
      forTheAgent(
        'reference/example.md',
        page(
          'Before.',
          '',
          '<div data-variable="example.image_model example.most_image">',
          '',
          '<!-- prettier-ignore -->',
          '```yaml',
          'model: gateway/openai/gpt-image-2',
          'retry: gateway/openai/gpt-image-2',
          'most: 20 MiB',
          'other: gateway/openai/gpt-image-2.6-flare',
          '```',
          '',
          '</div>',
          '',
          '```yaml',
          'model: gateway/openai/gpt-image-2',
          '```',
        ),
        onACloud,
      ),
    ).toBe(
      page(
        'Before.',
        '',
        '```yaml',
        'model: auto/openai/gpt-image-2',
        'retry: auto/openai/gpt-image-2',
        'most: 8 MiB',
        'other: gateway/openai/gpt-image-2.6-flare',
        '```',
        '',
        '```yaml',
        'model: gateway/openai/gpt-image-2',
        '```',
      ),
    );
  });
});

describe('a code example that declares two values', () => {
  const shorterEachTime: GuideVariables = {
    'example.longest': { value: '5 minutes', default: '10 minutes' },
    'example.shortest': { value: '2 minutes', default: '5 minutes' },
  };

  it('holds each as the server has it, though the value of one is the words of the other’s default', () => {
    expect(
      forTheAgent(
        'reference/example.md',
        page(
          '<div data-variable="example.longest example.shortest">',
          '',
          '```yaml',
          'longest: 10 minutes',
          'shortest: 5 minutes',
          '```',
          '',
          '</div>',
        ),
        shorterEachTime,
      ),
    ).toBe(page('```yaml', 'longest: 5 minutes', 'shortest: 2 minutes', '```'));
  });

  it('is refused where the two defaults share their words, which the example cannot tell apart', () => {
    const sharing: GuideVariables = {
      'example.wait': { value: '30 minutes', default: '10 minutes' },
      'example.retry': { value: '2 minutes', default: '10 minutes' },
      'example.first_wait': { value: 'the 30 minutes', default: 'the 10 minutes' },
    };
    const declaring = (names: string, ...lines: readonly string[]) =>
      markingFaultsOf(page(`<div data-variable="${names}">`, '', '```yaml', ...lines, '```', '', '</div>'), sharing);

    expect([
      ...declaring('example.wait example.retry', 'wait: 10 minutes', 'retry: 10 minutes'),
      ...declaring('example.first_wait example.wait', 'wait: the 10 minutes'),
    ]).toEqual([
      'The line "<div data-variable="example.wait example.retry">" declares example.wait and example.retry in a code example where their defaults, "10 minutes" and "10 minutes", share their words, so the example cannot tell the two apart.',
      'The line "<div data-variable="example.first_wait example.wait">" declares example.first_wait and example.wait in a code example where their defaults, "the 10 minutes" and "10 minutes", share their words, so the example cannot tell the two apart.',
    ]);
  });
});

describe('a value a guide cannot fill', () => {
  it('is one the server does not declare, or not named as a value, in a clause or an example', () => {
    expect([
      ...markingFaultsOf(page('A <span data-variable="example.unset">x</span>.'), onACloud),
      ...markingFaultsOf(page('A <span data-variable="Most image">x</span>.'), onACloud),
      ...markingFaultsOf(page('A <span data-variable="example.kept example.most_image">x</span>.'), onACloud),
      ...markingFaultsOf(page('<div data-variable="example.unset">', '', '```', 'x', '```', '', '</div>'), onACloud),
      ...markingFaultsOf(page('<div data-variable="kept">', '', '```', 'x', '```', '', '</div>'), onACloud),
    ]).toEqual([
      'The line "A <span data-variable="example.unset">x</span>." names the value example.unset, which this server does not declare.',
      'The line "A <span data-variable="Most image">x</span>." names no value a page may name in data-variable="Most image": name one value, each a capability\'s name and the value\'s, such as generation.most_image, separated by one space.',
      'The line "A <span data-variable="example.kept example.most_image">x</span>." names no value a page may name in data-variable="example.kept example.most_image": name one value, each a capability\'s name and the value\'s, such as generation.most_image, separated by one space.',
      'The line "<div data-variable="example.unset">" names the value example.unset, which this server does not declare.',
      'The line "<div data-variable="kept">" names no value a page may name in data-variable="kept": name one or more values, each a capability\'s name and the value\'s, such as generation.most_image, separated by one space.',
    ]);
  });
});

describe('a value a code example declares, which a guide cannot fill', () => {
  it('is declared by an example that does not hold its default as a whole value, or that is no single fenced example set apart', () => {
    const declaring = '<div data-variable="example.image_model">';

    expect([
      ...markingFaultsOf(
        page(declaring, '', '```', 'model: gateway/openai/gpt-image-2.6', '```', '', '</div>'),
        onACloud,
      ),
      ...markingFaultsOf(page(declaring, '', '    model: gateway/openai/gpt-image-2', '', '</div>'), onACloud),
      ...markingFaultsOf(page(declaring, '', '```', 'a', '```', '', '```', 'b', '```', '', '</div>'), onACloud),
      ...markingFaultsOf(page(declaring, '', '<p>gateway/openai/gpt-image-2</p>', '', '</div>'), onACloud),
      ...markingFaultsOf(
        page('Before.', declaring, '', '```', 'gateway/openai/gpt-image-2', '```', '', '</div>'),
        onACloud,
      ),
    ]).toEqual([
      'The line "<div data-variable="example.image_model">" declares example.image_model in a code example that does not hold its default, "gateway/openai/gpt-image-2", as a whole value.',
      'The line "<div data-variable="example.image_model">" declares a code example in a form a page may not use: <div data-variable="…"> alone on its line, a blank line, one fenced code example, a blank line and </div>, set apart by blank lines.',
      'The line "<div data-variable="example.image_model">" declares a code example in a form a page may not use: <div data-variable="…"> alone on its line, a blank line, one fenced code example, a blank line and </div>, set apart by blank lines.',
      'The line "<div data-variable="example.image_model">" declares a code example in a form a page may not use: <div data-variable="…"> alone on its line, a blank line, one fenced code example, a blank line and </div>, set apart by blank lines.',
      'The line "<div data-variable="example.image_model">" declares a code example in a form a page may not use: <div data-variable="…"> alone on its line, a blank line, one fenced code example, a blank line and </div>, set apart by blank lines.',
    ]);
  });
});

describe('a value marked with a passage for another reader', () => {
  it('is refused inside one, and around one', () => {
    expect([
      ...markingFaultsOf(
        page('A<span data-audience="operator"> b <span data-variable="example.kept">90 days</span></span>.'),
        onACloud,
      ),
      ...markingFaultsOf(
        page('A <span data-variable="example.kept"><span data-audience="operator">90 days</span></span>.'),
        onACloud,
      ),
      ...markingFaultsOf(
        page(
          '<div data-audience="operator">',
          '',
          '<div data-variable="example.kept">',
          '',
          '```',
          '90 days',
          '```',
          '',
          '</div>',
          '',
          '</div>',
        ),
        onACloud,
      ),
    ]).toEqual([
      'The line "A<span data-audience="operator"> b <span data-variable="example.kept">90 days</s…" holds HTML or another marking inside a marked span.',
      'The line "A <span data-variable="example.kept"><span data-audience="operator">90 days</spa…" holds HTML or another marking inside a marked span.',
      'The line "<div data-variable="example.kept">" holds HTML or another marking inside a marked passage.',
    ]);
  });
});

describe('the default a page writes for a value', () => {
  it('is said to the documentation check when it is not the default the server declares', () => {
    expect(markingFaultsOf(page('A <span data-variable="example.kept">60 days</span>.'), onACloud)).toEqual([
      'The line "A <span data-variable="example.kept">60 days</span>." writes "60 days" as example.kept, whose default is "90 days".',
    ]);
  });

  it('never stops the page from being served: the guide says the value as the server has it, whatever default the page writes', () => {
    expect(
      forTheAgent('reference/example.md', page('A <span data-variable="example.kept">60 days</span>.'), onACloud),
    ).toBe(page('A 30 days.'));
  });

  it('is written in place by the documentation check, plainly or as code, and nothing else of the page changes', () => {
    const stale = page(
      '---',
      'description: An example',
      '---',
      '',
      '| Bound     | Limit                                                     |',
      '| --------- | --------------------------------------------------------- |',
      '| One image | <span data-variable="example.most_image">10 MiB</span> |',
      '',
      'Such as <span data-variable="example.image_model">`gateway/openai/old`</span>, kept <span data-variable="example.kept">90 days</span>.',
    );

    expect(withDefaultsWritten(stale, onACloud)).toBe(
      stale.replace('>10 MiB<', '>20 MiB<').replace('>`gateway/openai/old`<', '>`gateway/openai/gpt-image-2`<'),
    );
    expect(() => withDefaultsWritten(page('A <span data-variable="example.unset">x</span>.'), onACloud)).toThrow(
      'The line "A <span data-variable="example.unset">x</span>." names the value example.unset, which this server does not declare.',
    );
  });
});

describe('a default typed where its value belongs', () => {
  it('is found in a sentence and in an example that does not declare it, and not where the value is named or declared', () => {
    const typed = page(
      'An image holds at most <span data-variable="example.most_image">20 MiB</span>, and a reference 20 MiB.',
      '',
      '<div data-variable="example.image_model">',
      '',
      '```yaml',
      'model: gateway/openai/gpt-image-2',
      '```',
      '',
      '</div>',
      '',
      '```yaml',
      'kept: 90 days',
      '```',
    );

    expect(defaultsTypedIn('reference/example.md', typed, onACloud)).toEqual([
      'reference/example.md types "20 MiB", the default of example.most_image, where its value belongs.',
      'reference/example.md types "90 days", the default of example.kept, where its value belongs.',
    ]);
    expect(defaultsTypedIn('reference/example.md', withValues, onACloud)).toEqual([]);
  });
});
