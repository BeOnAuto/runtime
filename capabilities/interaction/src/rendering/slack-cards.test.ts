import type { CardElement } from 'chat';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { slackCardOf, slackMessageOfCard } from './slack-cards.ts';

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
