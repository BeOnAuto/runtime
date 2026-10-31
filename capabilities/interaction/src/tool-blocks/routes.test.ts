import { standingRenderClock } from '@on.auto/definitions/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { deliveryStarted } from '../facts/fact-words.ts';
import { deliveryVariablesOf, renderedArguments } from './rendered-arguments.ts';
import { routeOf, throughWords, toolsOf } from './routes.ts';

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

const record = {
  to: 'ada',
  message: 'Approve?',
  expires_at: '2026-10-09T09:00:00.000Z',
  requested_at: '2026-10-07T09:00:00.000Z',
};

describe('the arguments of a call', () => {
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
    expect(renderedArguments({ text: '{{ to }}: {{ message }}' }, variables, standingRenderClock)).toEqual(
      Result.succeed({ input: { text: 'ada: Approve?' }, bytes: 24 }),
    );
  });

  it('fail at an argument that does not compile or renders no text, and past the bound of a call', () => {
    expect([
      renderedArguments({ a: '{{ to' }, { to: 'ada' }, standingRenderClock),
      renderedArguments({ a: 'Input: {{ input }}' }, { input: { a: 1 } }, standingRenderClock),
      renderedArguments({ a: '{{ text }}', b: '{{ text }}' }, { text: 'x'.repeat(9000) }, standingRenderClock),
    ]).toMatchObject([
      Result.fail({ reason: 'argument', argument: 'a', failure: { reason: 'failed', line: 1 } }),
      Result.fail({ reason: 'argument', argument: 'a', failure: { reason: 'not_text' } }),
      Result.fail({ reason: 'too_large', bytes: 18_015 }),
    ]);
  });
});

const schema = { type: 'object', properties: { choice: { enum: ['approve', 'reject'] } } };

const typed = deliveryVariablesOf(
  { ...record, answer_schema: schema },
  { input: { limit: 20, channel: '#approvals' }, runId: 'run-1', functionName: 'approve' },
);

function inputOf(templates: Parameters<typeof renderedArguments>[0]) {
  return Result.map(renderedArguments(templates, typed, standingRenderClock), ({ input }) => input);
}

describe('an argument written as a value', () => {
  it('is sent as written when it is a number, a boolean, null, a list or an object, its strings rendered', () => {
    expect([
      inputOf({ limit: 20, unfurl: false, after: null }),
      inputOf({ blocks: [{ type: 'section', text: 'Hello {{ to }}' }, 3] }),
    ]).toEqual([
      Result.succeed({ limit: 20, unfurl: false, after: null }),
      Result.succeed({ blocks: [{ type: 'section', text: 'Hello ada' }, 3] }),
    ]);
  });

  it('is the value an expression reads when its string is that one expression alone, and text otherwise', () => {
    expect([
      inputOf({ limit: '{{ input.limit }}' }),
      inputOf({ schema: '{{ answer_schema }}' }),
      inputOf({ text: 'Hello {{ to }}', count: ' {{ input.limit }}' }),
      inputOf({ channels: ['{{ input.channel }}', '{{ input }}'] }),
    ]).toEqual([
      Result.succeed({ limit: 20 }),
      Result.succeed({ schema }),
      Result.succeed({ text: 'Hello ada', count: ' 20' }),
      Result.succeed({ channels: ['#approvals', { limit: 20, channel: '#approvals' }] }),
    ]);
  });

  it('fails at its path when an expression alone reads no JSON, or more than a call may send', () => {
    expect([
      inputOf({ blocks: [{ count: '{{ 1 | divided_by: 0 }}' }] }),
      renderedArguments({ a: '{{ text }}' }, { text: 'x'.repeat(16_384) }, standingRenderClock),
      inputOf({ a: '{{ nothing }}' }),
    ]).toMatchObject([
      Result.fail({
        reason: 'argument',
        argument: 'blocks/0/count',
        failure: { reason: 'failed', detail: 'The expression reads a value that is not JSON' },
      }),
      Result.fail({ reason: 'argument', argument: 'a', failure: { reason: 'too_long' } }),
      Result.fail({ reason: 'argument', argument: 'a', failure: { reason: 'missing_variable' } }),
    ]);
  });
});
