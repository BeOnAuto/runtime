import { toolBounds } from '@on.auto/tool-servers';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { mostInputBytes } from '../runs/recorded-size.ts';
import { standingRenderClock } from '../testing/time/stepping-clock.ts';
import {
  argumentsFailureWords,
  momentVariables,
  renderedArguments,
  smallerInputRemedy,
  variablesReadInside,
  type ArgumentsFailure,
  type Templates,
} from './rendered-arguments.ts';

const schema = { type: 'object', properties: { choice: { enum: ['approve', 'reject'] } } };

const variables = {
  ...momentVariables({ limit: 20, channel: '#approvals' }, '2026-10-07T09:00:00.000Z'),
  to: 'ada',
  schema,
};

const mebibyte = 1_048_576;

const mostBytes = toolBounds.requestBytes;

function remedied(failure: ArgumentsFailure): string {
  return argumentsFailureWords(failure, 'the call', smallerInputRemedy);
}

function inputOf(templates: Templates) {
  return Result.map(renderedArguments(templates, variables, standingRenderClock, mostBytes), ({ input }) => input);
}

describe('the moments a call renders over', () => {
  it('are the input, the day and the instant it starts', () => {
    expect(momentVariables({ a: 1 }, '2026-10-07T09:00:00.000Z')).toEqual({
      input: { a: 1 },
      today: '2026-10-07',
      now: '2026-10-07T09:00:00.000Z',
    });
  });
});

describe('the arguments of a call', () => {
  it('are rendered with their size as JSON', () => {
    expect(renderedArguments({ text: '{{ to }} on {{ today }}' }, variables, standingRenderClock, mostBytes)).toEqual(
      Result.succeed({ input: { text: 'ada on 2026-10-07' }, bytes: 28 }),
    );
  });

  it('fail at an argument that does not compile or renders no text, and past the bound they are given', () => {
    expect([
      renderedArguments({ a: '{{ to' }, { to: 'ada' }, standingRenderClock, mostBytes),
      renderedArguments({ a: 'Input: {{ input }}' }, { input: { a: 1 } }, standingRenderClock, mostBytes),
      renderedArguments(
        { a: '{{ text }}', b: '{{ text }}' },
        { text: 'x'.repeat(524_300) },
        standingRenderClock,
        mebibyte,
      ),
    ]).toMatchObject([
      Result.fail({ reason: 'argument', argument: 'a', failure: { reason: 'failed', line: 1 } }),
      Result.fail({ reason: 'argument', argument: 'a', failure: { reason: 'not_text' } }),
      Result.fail({ reason: 'too_large', bytes: 1_048_615, most: mebibyte }),
    ]);
  });

  it('may take what a run may take as its input at the least a call may send, so any input a run takes, sent as it is, is arguments a call may send', () => {
    const page = 'x'.repeat(mostInputBytes - JSON.stringify({ page: '' }).length);
    const moment = momentVariables({ page }, '2026-11-10T09:00:00.000Z');

    expect([mostInputBytes, toolBounds.handArgumentBytes]).toEqual([mebibyte, mostInputBytes]);
    expect(renderedArguments({ page: '{{ input.page }}' }, moment, standingRenderClock, mebibyte)).toEqual(
      Result.succeed({ input: { page }, bytes: mostInputBytes }),
    );
    expect(renderedArguments({ page: '{{ input.page }}', path: 'a' }, moment, standingRenderClock, mebibyte)).toEqual(
      Result.fail({ reason: 'too_large', bytes: mostInputBytes + 11, most: mebibyte }),
    );
  });

  it('may be many times the input they render, up to the bound, as a template that writes a value again and again', () => {
    const page = 'x'.repeat(mebibyte - JSON.stringify({ page: '' }).length);
    const moment = momentVariables({ page }, '2026-11-10T09:00:00.000Z');
    const eight = { content: '{{ input.page }}'.repeat(8) };

    const rendered = renderedArguments(eight, moment, standingRenderClock, 8 * mebibyte);
    const past = renderedArguments({ ...eight, more: '{{ input.page }}' }, moment, standingRenderClock, 8 * mebibyte);

    expect(Result.map(rendered, ({ bytes }) => bytes)).toEqual(Result.succeed(8 * page.length + 14));
    expect(past).toMatchObject(Result.fail({ reason: 'too_large', bytes: 9 * page.length + 24, most: 8 * mebibyte }));
  });
});

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
      inputOf({ schema: '{{ schema }}' }),
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
      renderedArguments({ a: '{{ text }}' }, { text: 'x'.repeat(mebibyte) }, standingRenderClock, mebibyte),
      renderedArguments({ a: 'At {{ text }}' }, { text: 'x'.repeat(mebibyte) }, standingRenderClock, mebibyte),
      inputOf({ a: '{{ nothing }}' }),
    ]).toMatchObject([
      Result.fail({
        reason: 'argument',
        argument: 'blocks/0/count',
        failure: { reason: 'failed', detail: 'The expression reads a value that is not JSON' },
      }),
      Result.fail({ reason: 'argument', argument: 'a', failure: { reason: 'too_long' } }),
      Result.fail({ reason: 'argument', argument: 'a', failure: { reason: 'too_long' } }),
      Result.fail({ reason: 'argument', argument: 'a', failure: { reason: 'missing_variable' } }),
    ]);
  });
});

describe('the words of arguments that could not be rendered', () => {
  it('name the argument and why, or the size of all of them, for the call they belong to', () => {
    expect([
      argumentsFailureWords({ reason: 'too_large', bytes: 9_000_000, most: 8 * mebibyte }, 'the call'),
      argumentsFailureWords(
        { reason: 'argument', argument: 'a', failure: { reason: 'not_text', line: 1 }, most: mostBytes },
        'the call',
      ),
      argumentsFailureWords(
        { reason: 'argument', argument: 'a', failure: { reason: 'too_long', line: 1 }, most: 4 * mebibyte },
        'the read',
      ),
      argumentsFailureWords(
        {
          reason: 'argument',
          argument: 'a',
          failure: { reason: 'limit_exceeded', limit: 'time', line: 1 },
          most: mostBytes,
        },
        'the call',
      ),
    ]).toEqual([expect.any(String), expect.any(String), expect.any(String), expect.any(String)]);
  });

  it('end with what to do, where the caller gives it, once the arguments or one of them are past what a call may send', () => {
    expect([
      remedied({ reason: 'too_large', bytes: 17_000_000, most: mostBytes }),
      remedied({ reason: 'argument', argument: 'a', failure: { reason: 'too_long', line: 1 }, most: mostBytes }),
      remedied({
        reason: 'argument',
        argument: 'a',
        failure: { reason: 'missing_variable', variable: 'b', line: 1 },
        most: mostBytes,
      }),
    ]).toEqual([expect.any(String), expect.any(String), 'The argument a of the call reads a value it does not have']);
  });
});

describe('the variables a call block reads inside', () => {
  it('are those of its templates that mix text or apply a filter, in lists and objects, and none of a lone expression it passes whole or of one that does not parse', () => {
    const read = variablesReadInside({
      whole: '{{ input.page }}',
      filtered: '{{ input.rows | json }}',
      nested: { list: ['# {{ input.title }}', 3] },
      broken: 'a {{ input.',
      count: 2,
    });

    expect(read.map(({ path }) => path)).toEqual([
      ['input', 'rows'],
      ['input', 'title'],
    ]);
  });
});
