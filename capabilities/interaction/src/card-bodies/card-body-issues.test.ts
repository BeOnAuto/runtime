import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { cardBodyIssues } from './card-body-issues.ts';

const lines = new Map([
  ['', 4],
  ['/elements/card/props/title', 9],
  ['/elements/card/props/title/$template', 9],
]);

function readingCard(path: string): Schema.Json {
  return {
    root: 'card',
    elements: {
      card: { type: 'Card', props: { title: { $state: path } }, children: ['first', 'second'] },
      first: { type: 'Text', props: { content: 'One' } },
      second: { type: 'Text', props: { content: 'Two' } },
    },
  };
}

function issuesOf(card: Schema.Json, inputSchema?: Schema.JsonObject, takesAnswer = false): readonly string[] {
  return cardBodyIssues('slack', card, lines, { inputSchema, takesAnswer }).map(
    ({ line, pointer, detail }) => `${line} ${pointer}: ${detail}`,
  );
}

const closed: Schema.JsonObject = {
  type: 'object',
  additionalProperties: false,
  properties: { review: { type: 'string' } },
};

describe('the card of a request with render', () => {
  it('has no issue when it reads the input, the day and the time', () => {
    expect([
      issuesOf(readingCard('/input/review'), closed),
      issuesOf(readingCard('/input')),
      issuesOf(readingCard('/today')),
      issuesOf(readingCard('/now')),
      issuesOf(readingCard('/input/a~1b/0')),
    ]).toEqual([[], [], [], [], []]);
  });

  it('is refused for what the target cannot show, at the place it was written', () => {
    expect(issuesOf({ root: 'card', elements: {} })).toEqual([
      '4 /root: Root names "card", which is not under `elements`; add it or name another element',
    ]);
  });
});

describe('the layout of the card of a request with render', () => {
  it('is refused for a layout the guide tells not to write, at the place it was written', () => {
    const card = {
      root: 'card',
      elements: {
        card: { type: 'Card', props: { title: 'Orders' }, children: ['only'] },
        only: { type: 'Text', props: { content: 'Open https://example.com' } },
      },
    };

    expect(issuesOf(card, undefined, true)).toEqual([
      '4 /elements/card: A card with one piece is a text: split it into the parts a reader looks for, as the guide\'s "Lay the card out" says',
      '4 /elements/only/props/content: A link in a text is easy to miss: move it to a LinkButton under Actions',
      '4 /elements/card: A reader answers by replying: add a muted Text that says exactly what to reply',
    ]);
  });
});

describe('the paths the card of a request with render reads', () => {
  it('is refused for a path that starts at nothing the run supplies', () => {
    expect(issuesOf(readingCard('/user/name'))).toEqual([
      '9 /elements/card/props/title/$state: Reads /user/name, which a request does not have; start the path with /input, /today or /now',
    ]);
    expect(issuesOf(readingCard('input/review'))).toEqual([
      '9 /elements/card/props/title/$state: Reads input/review, which a request does not have; start the path with /input, /today or /now',
    ]);
    expect(issuesOf(readingCard(''))).toHaveLength(1);
  });

  it('is refused for a property of the input its closed schema does not have', () => {
    expect(issuesOf(readingCard('/input/missing'), closed)).toEqual([
      '9 /elements/card/props/title/$state: input.missing is not a property of the input schema, which allows no others',
    ]);
  });

  it('is refused for a property of the day or the time', () => {
    expect(issuesOf(readingCard('/today/year'))).toEqual([
      '9 /elements/card/props/title/$state: today is the date, as YYYY-MM-DD, and has no properties',
    ]);
  });

  it('is refused for a path inside a template as well', () => {
    const card = {
      root: 'card',
      elements: {
        card: { type: 'Card', props: { title: { $template: 'Hello ${/user/name}' } }, children: ['a', 'b'] },
        a: { type: 'Divider' },
        b: { type: 'Divider' },
      },
    };

    expect(issuesOf(card)).toEqual([
      '9 /elements/card/props/title/$template: Reads /user/name, which a request does not have; start the path with /input, /today or /now',
    ]);
  });
});
