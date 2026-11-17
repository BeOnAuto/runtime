import { standingRenderClock } from '@on.auto/definitions/testing';
import { renderedArguments } from '@on.auto/definitions/tool-blocks';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { deliveryStarted } from '../facts/fact-words.ts';
import { fakeRequestBytes } from '../testing/fake-tools.ts';
import { answering, delivering, documentOf, problemsOf, reading, replacing } from '../testing/route-documents.ts';
import { deliveryVariablesOf } from './delivery-arguments.ts';
import { routeOf, throughWords, toolsOf } from './routes.ts';

const record = {
  to: 'ada',
  message: 'Approve?',
  expires_at: '2026-10-09T09:00:00.000Z',
  requested_at: '2026-10-07T09:00:00.000Z',
};

describe('the arguments of a delivery', () => {
  it('are rendered over the request, its moment, its run and its function, the schema null for a notification', () => {
    const variables = deliveryVariablesOf(record, { input: { a: 1 }, runId: 'run-1', functionName: 'approve' });

    expect(variables).toEqual({
      input: { a: 1 },
      today: '2026-10-07',
      now: '2026-10-07T09:00:00.000Z',
      to: 'ada',
      message: 'Approve?',
      run_id: 'run-1',
      function: 'approve',
      expires_at: '2026-10-09T09:00:00.000Z',
      answer_schema: null,
    });
    expect(
      renderedArguments({ text: '{{ to }}: {{ message }}' }, variables, standingRenderClock, fakeRequestBytes),
    ).toEqual(Result.succeed({ input: { text: 'ada: Approve?' }, bytes: 24 }));
  });

  it('read the answer schema of a request that takes an answer', () => {
    const schema = { type: 'object', properties: { choice: { enum: ['approve', 'reject'] } } };
    const variables = deliveryVariablesOf(
      { ...record, answer_schema: schema },
      { input: {}, runId: 'run-1', functionName: 'approve' },
    );

    expect(
      renderedArguments({ schema: '{{ answer_schema }}' }, variables, standingRenderClock, fakeRequestBytes),
    ).toEqual(Result.succeed({ input: { schema }, bytes: 82 }));
  });
});

const chat = { server: 'chat', tool: 'post_message' };

const replies = {
  tool: 'thread_replies',
  with: {},
  read: { list: '/messages', order: 'oldest_first', each: { id: '/ts', sender: '/user', text: '/text' } },
  tell: { tool: 'post_reply', with: {} },
} as const;

describe('the route of a request', () => {
  it('is held for an agent without a delivery, and else the tool and how replies are read', () => {
    expect([routeOf({}), routeOf({ deliver: { ...chat } }), routeOf({ deliver: chat, replies })]).toEqual([
      { kind: 'agent' },
      { kind: 'tool', delivery: chat },
      { kind: 'tool', delivery: chat, replies },
    ]);
  });

  it('names every tool it calls once, through the server it delivers through', () => {
    expect([
      toolsOf(routeOf({})),
      toolsOf(routeOf({ deliver: chat })),
      toolsOf(routeOf({ deliver: chat, replies })),
      toolsOf(routeOf({ deliver: chat, replies: { ...replies, tool: 'post_message', tell: { with: {} } } })),
    ]).toEqual([
      [],
      [chat],
      [chat, { server: 'chat', tool: 'thread_replies' }, { server: 'chat', tool: 'post_reply' }],
      [chat],
    ]);
  });

  it('is told in the same words by the capability and by the history of a delivery', () => {
    const through = throughWords(routeOf({ deliver: chat }));

    expect([through, throughWords(routeOf({}))]).toEqual([
      'through the post message tool of chat',
      'held for an agent',
    ]);
    expect(deliveryStarted({ type: 'delivery_started', data: { number: 1, target: 'ada', ...chat } })).toBe(
      `Delivery attempt 1 of the request started, ${through}.`,
    );
  });
});

const deliveryNames = 'input, today, now, to, message, run_id, function, expires_at and answer_schema';

function deliveringText(text: string): readonly string[] {
  return replacing(delivering, "    text: '{{ message }}'", `    text: '${text}'`);
}

describe('the templates of a delivery', () => {
  it('refuse a name a delivery does not have, a template that does not compile, and a ${', () => {
    expect([
      problemsOf(documentOf(deliveringText('{{ party }}'))),
      problemsOf(documentOf(deliveringText('{{ message'))),
      problemsOf(documentOf(deliveringText('Bearer ${CHAT_KEY}'))),
    ]).toEqual([
      [
        `Line 9, /deliver/with/text: Reads party, which a template of a delivery does not have; it reads ${deliveryNames}`,
      ],
      [expect.stringMatching(/^Line 9, \/deliver\/with\/text: /u)],
      ['Line 9, /deliver/with/text: Expected no ${ in a template, which never holds a secret'],
    ]);
    expect(problemsOf(documentOf(deliveringText('{{ to }}'.repeat(1100))))).toEqual([
      expect.stringContaining('A template may use at most 1000 names'),
    ]);
  });

  it('refuse a property of the input its closed schema does not have, and the moments read as objects', () => {
    const closed = [
      'input:',
      '  schema: { type: object, additionalProperties: false, properties: { owner: { type: string } } }',
    ];

    expect([
      problemsOf(documentOf(deliveringText('{{ input.missing }}'), closed)),
      problemsOf(documentOf(deliveringText('{{ today.year }}'))),
    ]).toEqual([
      [
        'Line 9, /deliver/with/text: input.missing is not a property of the input schema, which allows no others',
        expect.stringContaining('input.campaign is not a property'),
      ],
      ['Line 9, /deliver/with/text: today is the date, as YYYY-MM-DD, and has no properties'],
    ]);
  });
});

describe('a delivery argument and the values it holds', () => {
  it('refuse a structure inside a longer text, and take one written | json, one alone, or one that reads the input', () => {
    expect([
      problemsOf(documentOf(deliveringText('Schema: {{ answer_schema }}'))),
      problemsOf(documentOf(deliveringText('Schema: {{ answer_schema | json }}'))),
      problemsOf(documentOf(deliveringText('{{ answer_schema }}'))),
      problemsOf(documentOf(deliveringText('Input: {{ input }}'))),
    ]).toEqual([
      [
        'Line 9, /deliver/with/text: Renders a value that is not text among text; write | json after it, or write it alone as one {{ }} to send it as it is',
      ],
      [],
      [],
      [],
    ]);
  });

  it('check every string within a value written as a number, a list or an object, at its own path', () => {
    const typed = replacing(
      delivering,
      "    text: '{{ message }}'",
      "    limit: 20\n    blocks:\n      - type: section\n        text: 'Hello {{ party }}'",
    );

    expect(problemsOf(documentOf(typed))).toEqual([
      `Line 12, /deliver/with/blocks/0/text: Reads party, which a template of a delivery does not have; it reads ${deliveryNames}`,
    ]);
  });
});

describe('the templates of a reading and a telling', () => {
  it('refuse a name each does not have, with the names each reads', () => {
    const keyed = replacing(
      reading,
      "  conversation: '{{ sent.conversation }}/{{ sent.id }}'",
      "  conversation: '{{ since }}'",
    );
    const readWith = replacing(reading, "    ts: '{{ sent.id }}'", "    ts: '{{ sent.thread }}'");
    const told = replacing(reading, "      text: '{{ message }}'", "      text: '{{ since }}'");

    expect([
      problemsOf(documentOf(delivering, keyed, answering)),
      problemsOf(documentOf(delivering, readWith, answering)),
      problemsOf(documentOf(delivering, told, answering)),
    ]).toEqual([
      [
        'Line 14, /replies/conversation: Reads since, which the conversation key of a reading does not have; it reads to, sent.conversation and sent.id',
      ],
      [
        'Line 18, /replies/with/ts: Reads sent.thread, which a template of a reading does not have; it reads to, sent.conversation, sent.id, conversation and since',
      ],
      [
        'Line 30, /replies/tell/with/text: Reads since, which a template of a telling does not have; it reads to, sent.conversation, sent.id, message, reply.id and reply.to',
      ],
    ]);
  });
});

describe('the values a reading and a telling send', () => {
  it('refuse a structure inside a longer text, and a conversation key that is not text', () => {
    const inText = replacing(reading, "    ts: '{{ sent.id }}'", "    ts: 'At {{ sent }}'");
    const alone = replacing(reading, "    ts: '{{ sent.id }}'", "    ts: '{{ sent }}'");
    const keyed = replacing(
      reading,
      "  conversation: '{{ sent.conversation }}/{{ sent.id }}'",
      "  conversation: '{{ sent }}'",
    );

    expect([
      problemsOf(documentOf(delivering, inText, answering)),
      problemsOf(documentOf(delivering, alone, answering)),
      problemsOf(documentOf(delivering, keyed, answering)),
    ]).toEqual([
      [
        'Line 18, /replies/with/ts: Renders a value that is not text among text; write | json after it, or write it alone as one {{ }} to send it as it is',
      ],
      [],
      [
        'Line 14, /replies/conversation: Renders a value that is not text; write | json after a structured value such as sent',
      ],
    ]);
  });
});
