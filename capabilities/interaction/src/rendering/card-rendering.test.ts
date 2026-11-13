import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { renderedCard } from './card-rendering.ts';
import type { RenderState } from './rendered-message.ts';

function render(card: Schema.Json, input: Schema.Json = {}) {
  const state: RenderState = { input, today: '2026-10-07', now: '2026-10-07T09:00:00.000Z' };
  return renderedCard('slack', card, state);
}

function messageOf(card: Schema.Json, input: Schema.Json = {}) {
  const rendered = render(card, input);
  return Result.isSuccess(rendered) ? rendered.success : undefined;
}

function issuesOf(card: Schema.Json, input: Schema.Json = {}): readonly string[] {
  const rendered = render(card, input);
  return Result.isFailure(rendered) ? rendered.failure : [];
}

const orderCard = {
  root: 'card',
  elements: {
    card: { type: 'Card', props: { title: 'Order' }, children: ['intro', 'rule', 'facts'] },
    intro: { type: 'Text', props: { content: 'Ready to ship', style: 'bold' } },
    rule: { type: 'Divider', props: {} },
    facts: { type: 'Fields', props: {}, children: ['seats', 'total'] },
    seats: { type: 'Field', props: { label: 'Seats', value: 3 } },
    total: { type: 'Field', props: { label: 'Total', value: '$30' } },
  },
};

const readingCard = {
  root: 'card',
  elements: {
    card: { type: 'Card', props: { title: { $template: 'Hello ${/input/name}' } }, children: ['when', 'table'] },
    when: { type: 'Text', props: { content: { $state: '/today' } } },
    table: {
      type: 'Table',
      props: { headers: ['Item'], rows: [[{ $item: 'name' }]] },
      repeat: { statePath: '/input/items' },
    },
  },
};

const weeks = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'];
const web = [120, 135, 150, 148, 170, 190];
const mobile = [80, 95, 110, 130, 150, 175];

const chartCard = {
  root: 'card',
  elements: {
    card: { type: 'Card', props: { title: 'Weekly active users' }, children: ['chart'] },
    chart: {
      type: 'Chart',
      props: {
        title: 'Weekly active users',
        chart: {
          type: 'line',
          categories: weeks,
          series: [
            { name: 'Web', values: web },
            { name: 'Mobile', values: mobile },
          ],
          xLabel: 'Week',
          yLabel: 'Users',
        },
      },
    },
  },
};

function pointsOf(values: readonly number[]) {
  return weeks.map((label, index) => ({ label, value: values[index] }));
}

describe('a card of text, a divider and fields', () => {
  it('turns into blocks, with the text to fall back on', () => {
    expect(render(orderCard)).toEqual(
      Result.succeed({
        payload: [
          { type: 'header', text: { type: 'plain_text', text: 'Order', emoji: true } },
          { type: 'section', text: { type: 'mrkdwn', text: '*Ready to ship*' } },
          { type: 'divider' },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: '*Seats*\n3' },
              { type: 'mrkdwn', text: '*Total*\n$30' },
            ],
          },
        ],
        text: '*Order*\nReady to ship\n---\nSeats: 3\nTotal: $30',
      }),
    );
  });
});

describe('a card that reads the state', () => {
  it('shows a string, the day and a list of the input', () => {
    const message = messageOf(readingCard, { name: 'Ada', items: [{ name: 'Pen' }, { name: 'Ink' }] });

    expect(message?.payload).toMatchObject([
      { type: 'header', text: { text: 'Hello Ada' } },
      { type: 'section', text: { text: '2026-10-07' } },
      { type: 'data_table' },
    ]);
    expect(message?.text).toContain('Pen');
    expect(message?.text).toContain('Ink');
  });
});

describe('a chart of two weekly series', () => {
  it('draws a line chart under the header', () => {
    expect(render(chartCard)).toEqual(
      Result.succeed({
        payload: [
          { type: 'header', text: { type: 'plain_text', text: 'Weekly active users', emoji: true } },
          {
            type: 'data_visualization',
            title: 'Weekly active users',
            chart: {
              type: 'line',
              axis_config: { categories: weeks, x_label: 'Week', y_label: 'Users' },
              series: [
                { name: 'Web', data: pointsOf(web) },
                { name: 'Mobile', data: pointsOf(mobile) },
              ],
            },
          },
        ],
        text: '*Weekly active users*\nWeekly active users\nWeek | Web | Mobile\nW1   | 120 | 80\nW2   | 135 | 95\nW3   | 150 | 110\nW4   | 148 | 130\nW5   | 170 | 150\nW6   | 190 | 175',
      }),
    );
  });
});

describe('a card that fails at render', () => {
  it('comes back as issues when a required prop reads nothing', () => {
    const card = {
      root: 'card',
      elements: {
        card: { type: 'Card', props: { title: 'T' }, children: ['body'] },
        body: { type: 'Text', props: { content: { $state: '/input/missing' } } },
      },
    };

    expect(issuesOf(card)).toHaveLength(1);
    expect(issuesOf(card)[0]).toContain('content');
  });

  it('comes back as issues when the card would hold nothing', () => {
    const card = { root: 'card', elements: { card: { type: 'Card', props: { title: { $state: '/input/none' } } } } };

    expect(issuesOf(card)).toEqual(['the Card needs a title, an image or at least one child']);
  });

  it('comes back as issues when Slack could not hold what the card asks for', () => {
    const table = { type: 'Table', props: { headers: ['a'], rows: [['1']] } };
    const card = {
      root: 'card',
      elements: { card: { type: 'Card', props: {}, children: ['one', 'two'] }, one: table, two: table },
    };

    expect(issuesOf(card)).toEqual(['at most 1 Table per message']);
  });

  it('comes back as issues for a button in actions', () => {
    const card = {
      root: 'card',
      elements: {
        card: { type: 'Card', props: {}, children: ['actions'] },
        actions: { type: 'Actions', props: {}, children: ['yes'] },
        yes: { type: 'Button', props: { id: 'yes', label: 'Yes' } },
      },
    };

    expect(issuesOf(card)[0]).toContain('a button in actions');
  });
});

describe('a body that is not a card', () => {
  const notACard = ['The body is not a card: write `root` and `elements`'];

  it.each([
    ['text', 'hello'],
    ['no elements', { root: 'card' }],
    ['an element that is not a mapping', { root: 'card', elements: { card: 4 } }],
    ['props that are not a mapping', { root: 'card', elements: { card: { type: 'Card', props: 'x' } } }],
    ['children that are not a list', { root: 'card', elements: { card: { type: 'Card', children: 'x' } } }],
    ['a child that is not text', { root: 'card', elements: { card: { type: 'Card', children: [1] } } }],
  ])('fails for %s', (_what: string, body: Schema.Json) => {
    expect(issuesOf(body)).toEqual(notACard);
  });
});

describe('a defect in the run', () => {
  it('is not hidden behind an issue', () => {
    const card = { root: 'card', elements: { card: { type: 'Card', props: { title: { $state: '/input/boom' } } } } };
    const input = {
      get boom(): never {
        throw new RangeError('defect');
      },
    };

    expect(() => render(card, input)).toThrow('defect');
  });
});
