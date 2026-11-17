import type { CardElement } from 'chat';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { jsonOf } from './json-values.ts';
import { slackCardOf, slackMessageOfCard } from './slack-cards.ts';
import { stateReadsOf } from './state-reads.ts';

describe('a value read as JSON', () => {
  it('is kept when it is plain JSON', () => {
    expect(jsonOf({ a: [1, 'b', null] }, 'The value')).toEqual(Result.succeed({ a: [1, 'b', null] }));
  });

  it('is refused by name when it holds something JSON cannot', () => {
    expect(jsonOf({ a: undefined }, 'The value')).toEqual(Result.fail(['The value is not plain JSON']));
  });
});

const stateCard = {
  root: 'card',
  elements: {
    card: { type: 'Card', props: { title: { $state: '/input/title' } }, children: ['a/b'] },
    'a/b': {
      type: 'Text',
      props: { content: { $cond: { $state: '/input/flag' }, $then: 'yes', $else: { $state: '/today' } } },
      visible: { $state: '/input/shown' },
    },
  },
};

const templateCard = {
  root: 'card',
  elements: {
    card: { type: 'Card', props: { title: { $template: 'Hi ${/input/name}, it is ${/now} and ${bare}' } } },
  },
};

const repeatCard = {
  root: 'card',
  elements: {
    card: { type: 'Card', repeat: { statePath: '/input/items' }, props: { rows: [[{ $item: 'name' }]] } },
    inner: { type: 'Section', repeat: { statePath: { $item: 'children' } } },
  },
};

const ignoredCard = {
  root: 'card',
  elements: {
    card: {
      type: 'Card',
      props: { title: { $state: 3 }, subtitle: { $index: true }, list: ['x', { $item: 'y' }] },
    },
    broken: 'not an element',
  },
};

describe('the state a card reads', () => {
  it('is every $state value, with the pointer of where it was written', () => {
    expect(stateReadsOf(stateCard)).toEqual([
      { pointer: '/elements/card/props/title/$state', path: '/input/title' },
      { pointer: '/elements/a~1b/props/content/$cond/$state', path: '/input/flag' },
      { pointer: '/elements/a~1b/props/content/$else/$state', path: '/today' },
      { pointer: '/elements/a~1b/visible/$state', path: '/input/shown' },
    ]);
  });

  it('is every absolute path inside a $template string', () => {
    expect(stateReadsOf(templateCard)).toEqual([
      { pointer: '/elements/card/props/title/$template', path: '/input/name' },
      { pointer: '/elements/card/props/title/$template', path: '/now' },
    ]);
  });

  it('is the state path a repeat walks, when it is written absolute', () => {
    expect(stateReadsOf(repeatCard)).toEqual([{ pointer: '/elements/card/repeat/statePath', path: '/input/items' }]);
  });

  it('ignores a $state that is not text, other expressions and plain values', () => {
    expect(stateReadsOf(ignoredCard)).toEqual([]);
  });

  it('is nothing for a value that is not a card', () => {
    expect(stateReadsOf('text')).toEqual([]);
    expect(stateReadsOf({ root: 'card' })).toEqual([]);
    expect(stateReadsOf({ elements: [] })).toEqual([]);
  });
});

const everyPartCard: CardElement = {
  type: 'card',
  title: 'T',
  subtitle: 'S',
  imageUrl: 'https://example.com/i.png',
  children: [
    { type: 'text', content: 'plain' },
    { type: 'text', content: 'bold', style: 'bold' },
    { type: 'image', url: 'https://example.com/a.png', alt: 'A' },
    { type: 'image', url: 'https://example.com/b.png' },
    { type: 'divider' },
    { type: 'link', label: 'Docs', url: 'https://example.com' },
    { type: 'fields', children: [{ type: 'field', label: 'L', value: 'V' }] },
    { type: 'table', headers: ['a'], rows: [['1']] },
    { type: 'table', headers: ['a'], rows: [['1']], align: ['right'], caption: 'C' },
    { type: 'chart', title: 'Pie', chart: { type: 'pie', segments: [{ label: 's', value: 1 }] } },
    {
      type: 'chart',
      title: 'Line',
      chart: {
        type: 'line',
        categories: ['a'],
        xLabel: 'X',
        yLabel: 'Y',
        series: [{ name: 'n', data: [{ label: 'a', value: 1 }] }],
      },
    },
    {
      type: 'chart',
      title: 'Bar',
      chart: { type: 'bar', categories: ['a'], series: [{ name: 'n', data: [{ label: 'a', value: 1 }] }] },
    },
    { type: 'actions', children: [{ type: 'link-button', label: 'Go', url: 'https://example.com' }] },
    { type: 'section', children: [{ type: 'divider' }] },
  ],
};

describe('a card made for Slack', () => {
  it('keeps every part of a card the card can make', () => {
    expect(slackCardOf(everyPartCard)).toEqual(Result.succeed(everyPartCard));
  });

  it('is a card with no title when the card writes none', () => {
    expect(slackCardOf({ type: 'card', children: [{ type: 'divider' }] })).toEqual(
      Result.succeed({ type: 'card', children: [{ type: 'divider' }] }),
    );
  });
});

describe('a card Slack cannot show', () => {
  it('refuses a button in actions, which Slack would take clicks on', () => {
    const card: CardElement = {
      type: 'card',
      children: [{ type: 'actions', children: [{ type: 'button', id: 'yes', label: 'Yes' }] }],
    };

    expect(slackCardOf(card)).toEqual(
      Result.fail([
        'Slack cannot show a button in actions here: write only text, image, divider, fields, table, chart and link buttons',
      ]),
    );
  });

  it('refuses a text input, also inside a section', () => {
    const card: CardElement = {
      type: 'card',
      children: [{ type: 'section', children: [{ type: 'text_input', id: 'a', label: 'A' }] }],
    };

    expect(slackCardOf(card)).toEqual(
      Result.fail([
        'Slack cannot show a text input here: write only text, image, divider, fields, table, chart and link buttons',
      ]),
    );
  });

  it('comes with its blocks and its fallback text', () => {
    const message = slackMessageOfCard({ type: 'card', title: 'T', children: [{ type: 'text', content: 'Hi' }] });

    expect(message).toEqual(
      Result.succeed({
        payload: [
          { type: 'header', text: { type: 'plain_text', text: 'T', emoji: true } },
          { type: 'section', text: { type: 'mrkdwn', text: 'Hi' } },
        ],
        text: '*T*\nHi',
      }),
    );
  });

  it('is refused with the issues of the card it cannot show', () => {
    const message = slackMessageOfCard({ type: 'card', children: [{ type: 'text_input', id: 'a', label: 'A' }] });

    expect(Result.isFailure(message)).toBe(true);
  });
});
