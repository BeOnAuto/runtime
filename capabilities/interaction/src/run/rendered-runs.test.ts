import { describe, expect, it } from 'vitest';

import { askedRunId, fakeTools, interactionHarness } from '../testing/index.ts';
import { renderedDelivery, renderedDocument } from '../testing/rendered-documents.ts';
import { without } from '../testing/route-documents.ts';

const minute = 60_000;

function containing(text: string): unknown {
  return expect.stringContaining(text);
}

const failing = { outcome: 'server_failure', detail: 'The tool server answered HTTP 503', retryAfterMs: null } as const;

async function askedWith(source: string, input: unknown, definitionName = 'review-brief') {
  const tools = fakeTools();
  const playbook = interactionHarness({ tools });
  await playbook.define(definitionName, source);
  const asked = await playbook.ask(definitionName, input, askedRunId);
  return { playbook, tools, asked, askedAt: Date.now() };
}

const review = { owner: 'ada', review: 'The headline is clear and the offer is on page one.' };

describe('a request with render slack, once its run asks', () => {
  it('keeps the plain text of the card as its message and the blocks beside it', async () => {
    const { playbook } = await askedWith(renderedDocument(), review);

    expect(await playbook.runOf(askedRunId)).toMatchObject({
      status: 'succeeded',
      output: {
        status: 'started',
        record: {
          to: 'ada',
          message: '*Campaign brief review*\nThe headline is clear and the offer is on page one.',
          rendered: [
            { type: 'header', text: { type: 'plain_text', text: 'Campaign brief review' } },
            { type: 'section', text: { type: 'mrkdwn', text: 'The headline is clear and the offer is on page one.' } },
          ],
          deliver: { with: { blocks: '{{ rendered }}', text: '{{ message }}' } },
        },
      },
    });
  });

  it('delivers the blocks as a list holding what the input said, and the plain text beside them', async () => {
    const { playbook, tools, askedAt } = await askedWith(renderedDocument(), review);

    await playbook.performDue(askedAt);

    expect(tools.calls()).toMatchObject([
      {
        reference: { server: 'chat', tool: 'post_message' },
        input: {
          channel: 'ada',
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: 'Campaign brief review' } },
            { type: 'section', text: { type: 'mrkdwn', text: review.review } },
          ],
          text: `*Campaign brief review*\n${review.review}`,
        },
      },
    ]);
    expect(Array.isArray(tools.calls()[0]?.input['blocks'])).toBe(true);
  });
});

describe('the delivery of a request with render', () => {
  it('sends the same arguments at every attempt', async () => {
    const { playbook, tools, askedAt } = await askedWith(renderedDocument(), review);
    tools.answerNext(failing);

    await playbook.performDue(askedAt);
    await playbook.performDue(Date.now() + minute + 5000);

    const [first, second] = tools.calls();
    expect([tools.calls().length, second?.input]).toEqual([2, first?.input]);
  });
});

describe('the moment a card of a request with render reads', () => {
  it('is told the day and the time of the run by a card that reads them', async () => {
    const card = [
      'root: card',
      'elements:',
      '  card:',
      '    type: Card',
      '    props: { title: { $template: "Due ${/today}" } }',
      '    children: [when]',
      '  when:',
      '    type: Text',
      '    props: { content: { $state: /now } }',
    ];
    const { playbook, asked } = await askedWith(renderedDocument({ card }), review);

    expect(asked).toMatchObject({ status: 'succeeded' });
    const today = new Date().toISOString().slice(0, 10);
    expect(await playbook.runOf(askedRunId)).toMatchObject({
      output: {
        record: {
          message: containing(`Due ${today}`),
          rendered: [{ text: { text: `Due ${today}` } }, { text: { text: containing(today) } }],
        },
      },
    });
  });
});

const weeks = ['W1', 'W2', 'W3', 'W4'];

const chartInput = [
  'input:',
  '  schema:',
  '    type: object',
  '    required: [owner, weeks, web, mobile]',
  '    properties:',
  '      owner: { type: string }',
  '      weeks: { type: array, items: { type: string } }',
  '      web: { type: array, items: { type: number } }',
  '      mobile: { type: array, items: { type: number } }',
];

const chartCard = [
  'root: card',
  'elements:',
  '  card:',
  '    type: Card',
  '    props: { title: Weekly active users }',
  '    children: [chart]',
  '  chart:',
  '    type: Chart',
  '    props:',
  '      title: Weekly active users',
  '      chart:',
  '        type: line',
  '        categories: { $state: /input/weeks }',
  '        series:',
  '          - { name: Web, values: { $state: /input/web } }',
  '          - { name: Mobile, values: { $state: /input/mobile } }',
];

describe('a request with render slack whose card draws a chart from lists of the input', () => {
  it('delivers a chart block holding the numbers of the input, and the table of them as text', async () => {
    const source = renderedDocument({ input: chartInput, card: chartCard });
    const { playbook, tools, askedAt } = await askedWith(source, {
      owner: 'ada',
      weeks,
      web: [120, 135, 150, 148],
      mobile: [80, 95, 110, 130],
    });

    await playbook.performDue(askedAt);

    expect(tools.calls()).toMatchObject([
      {
        input: {
          blocks: [
            { type: 'header', text: { text: 'Weekly active users' } },
            {
              type: 'data_visualization',
              chart: {
                type: 'line',
                axis_config: { categories: weeks },
                series: [
                  { name: 'Web', data: [{ label: 'W1', value: 120 }, {}, {}, { label: 'W4', value: 148 }] },
                  { name: 'Mobile', data: [{ label: 'W1', value: 80 }, {}, {}, { label: 'W4', value: 130 }] },
                ],
              },
            },
          ],
          text: containing('W4 | 148 | 130'),
        },
      },
    ]);
  });
});

describe('a request with render slack whose card cannot be made', () => {
  it('ends the run as invalid input, with the issues of the render, before anything is sent', async () => {
    const card = [
      'root: card',
      'elements:',
      '  card:',
      '    type: Card',
      '    props: { title: T }',
      '    children: [body]',
      '  body:',
      '    type: Text',
      '    props: { content: { $state: /input/note } }',
    ];
    const { asked, tools, playbook } = await askedWith(renderedDocument({ card }), review);

    expect(asked).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The message cannot be rendered with this input',
      issues: [{ pointer: '/input', detail: containing('content') }],
    });
    expect(tools.calls()).toEqual([]);
    expect(await playbook.firstOpen()).toBeUndefined();
  });
});

describe('the bounds of a request with render', () => {
  it('ends the run as unworkable when the plain text passes the bytes a message may hold', async () => {
    const card = [
      'root: card',
      'elements:',
      '  card:',
      '    type: Card',
      '    props: { title: T }',
      '    children: [one, two, three]',
      ...['one', 'two', 'three'].flatMap((id) => [
        `  ${id}:`,
        '    type: Text',
        '    props: { content: { $state: /input/review } }',
      ]),
    ];
    const { asked } = await askedWith(renderedDocument({ card }), { ...review, review: 'x'.repeat(2900) });

    expect(asked).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'unworkable',
      detail: 'The message renders to more than the 8192 bytes a request may hold',
    });
  });

  it('ends the run as unworkable when the blocks pass the bytes a request may hold', async () => {
    const card = [
      'root: card',
      'elements:',
      '  card:',
      '    type: Card',
      '    props: { title: T }',
      '    children: [one, two]',
      ...['one', 'two'].flatMap((id) => [
        `  ${id}:`,
        '    type: Text',
        '    props: { content: { $state: /input/review } }',
      ]),
    ];
    const { asked } = await askedWith(renderedDocument({ card }), { ...review, review: '\u0001'.repeat(2990) });

    expect(asked).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'unworkable',
      detail: containing('more than the 32768 a request may hold'),
    });
  });
});

describe('a request without render', () => {
  it('still renders its body as a message and keeps no blocks', async () => {
    const withText = renderedDocument({
      front: ["to: '{{ input.owner }}'", 'expires: P2D'],
      delivery: without(renderedDelivery, "    blocks: '{{ rendered }}'"),
      card: ['Please review {{ input.review }}.'],
    });
    const { playbook, tools, askedAt } = await askedWith(withText, review);

    const asked = await playbook.runOf(askedRunId);
    await playbook.performDue(askedAt);

    expect(asked).toMatchObject({ output: { record: { message: `Please review ${review.review}.` } } });
    expect(asked).not.toHaveProperty('output.record.rendered');
    expect(tools.calls()).toMatchObject([{ input: { channel: 'ada', text: `Please review ${review.review}.` } }]);
  });
});
