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
    elements: { card: { type: 'Card', props: { title: { $state: path } } } },
  };
}

function issuesOf(card: Schema.Json, inputSchema?: Schema.JsonObject): readonly string[] {
  return cardBodyIssues('slack', card, lines, inputSchema).map(
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
      elements: { card: { type: 'Card', props: { title: { $template: 'Hello ${/user/name}' } } } },
    };

    expect(issuesOf(card)).toEqual([
      '9 /elements/card/props/title/$template: Reads /user/name, which a request does not have; start the path with /input, /today or /now',
    ]);
  });
});
