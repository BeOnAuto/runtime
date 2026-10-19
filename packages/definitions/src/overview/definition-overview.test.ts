import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  composedOverview,
  defineCapability,
  inputSection,
  markdownOf,
  named,
  paragraph,
  sectionOf,
  type Overview,
} from '../index.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { sectionIn } from '../testing/index.ts';

function overviewOf(source: string, name = 'greet'): string {
  return markdownOf(Effect.runSync(echo.prepare(source)).overview(name));
}

const told = defineCapability({
  type: 'told',
  title: 'Told',
  guide: { name: 'told' },
  noun: { one: 'telling', other: 'tellings' },
  describeOutput: () => 'It told.',
  mediaType: 'text/plain',
  parse: (source: string) => Effect.succeed({ words: source.trim() }),
  summarize: ({ words }) => ({ description: words, inputSchema: { type: 'object' } }),
  overview: ({ words }, name, { summary }) => ({
    body: [paragraph(`It is told as ${name}.`)],
    sections: [
      inputSection(),
      sectionOf(
        'What it says',
        paragraph('It says ', named(words), `, which it describes as ${summary.description ?? 'nothing'}.`),
      ),
    ],
    appendix: [sectionOf('Input', paragraph('A record.'))],
  }),
  run: ({ words }) => Effect.succeed({ output: words, record: {} }),
});

const sendBuild: Overview = composedOverview({
  name: 'send-build',
  noun: { one: 'item', other: 'items' },
  summary: {},
});

describe('the overview of a definition', () => {
  it('opens with its name and its description, then says what it needs and produces from its schemas', () => {
    expect(overviewOf('{"greeting": "Hello", "description": "Greets a guest"}')).toBe(
      [
        '# greet',
        'Greets a guest',
        '## What it needs',
        'A record.',
        '## What it produces',
        '| Field | Required | What it is |\n| --- | --- | --- |\n| **greeting** | yes | Exactly Hello. |\n| **input** | yes | A record. |',
        '',
      ]
        .join('\n\n')
        .replace(/\n\n$/u, '\n'),
    );
  });

  it('says in one line that a definition has no description yet, in the noun of its capability', () => {
    expect(overviewOf('{"greeting": "Hello"}', 'hello-there').split('\n\n').slice(0, 2)).toEqual([
      '# hello-there',
      'This greeting has no description yet.',
    ]);
  });
});

describe('the overview of a definition that says little', () => {
  it('says what a definition without schemas needs and produces, and that a blank description is none', () => {
    expect(
      markdownOf(
        composedOverview({ name: 'plain', noun: { one: 'item', other: 'items' }, summary: { description: ' \n' } }),
      ),
    ).toBe(
      [
        '# plain',
        'This item has no description yet.',
        '## What it needs',
        'It takes any input, which its document does not describe.',
        '## What it produces',
        'It produces any output, which its document does not describe.\n',
      ].join('\n\n'),
    );
  });

  it('holds sections a test reads by their heading, and none of a heading it does not write', () => {
    const written = markdownOf(sendBuild);

    expect([sectionIn(written, 'What it needs'), sectionIn(written, 'Used by')]).toEqual([
      'It takes any input, which its document does not describe.',
      '',
    ]);
  });
});

describe('the overview of a capability of its own', () => {
  it('is given in place of the one of every type, its body, its sections and its appendix, from the summary its capability made', () => {
    expect(markdownOf(Effect.runSync(told.prepare(' hello ')).overview('saying'))).toBe(
      [
        '# saying',
        'hello',
        'It is told as saying.',
        '## What it needs',
        'It takes any input, which its document does not describe.',
        '## What it says',
        'It says **hello**, which it describes as hello.',
        '## Details',
        '### Input',
        'A record.\n',
      ].join('\n\n'),
    );
  });

  it('is data the fact keeps, its title, its opening and its parts, with nothing written yet', () => {
    expect(Effect.runSync(told.prepare(' hello ')).overview('saying')).toEqual({
      title: 'saying',
      opening: ['hello'],
      body: [paragraph('It is told as saying.')],
      sections: [
        inputSection(),
        sectionOf('What it says', paragraph('It says ', named('hello'), ', which it describes as hello.')),
      ],
      appendix: [sectionOf('Input', paragraph('A record.'))],
    });
  });
});
