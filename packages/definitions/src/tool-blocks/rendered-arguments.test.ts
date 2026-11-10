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
  type ArgumentsFailure,
  type Templates,
} from './rendered-arguments.ts';

const schema = { type: 'object', properties: { choice: { enum: ['approve', 'reject'] } } };

const variables = {
  ...momentVariables({ limit: 20, channel: '#approvals' }, '2026-10-07T09:00:00.000Z'),
  to: 'ada',
  schema,
};

function remedied(failure: ArgumentsFailure): string {
  return argumentsFailureWords(failure, 'the call', smallerInputRemedy);
}

function inputOf(templates: Templates) {
  return Result.map(renderedArguments(templates, variables, standingRenderClock), ({ input }) => input);
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
    expect(renderedArguments({ text: '{{ to }} on {{ today }}' }, variables, standingRenderClock)).toEqual(
      Result.succeed({ input: { text: 'ada on 2026-10-07' }, bytes: 28 }),
    );
  });

  it('fail at an argument that does not compile or renders no text, and past the bound of a call', () => {
    expect([
      renderedArguments({ a: '{{ to' }, { to: 'ada' }, standingRenderClock),
      renderedArguments({ a: 'Input: {{ input }}' }, { input: { a: 1 } }, standingRenderClock),
      renderedArguments({ a: '{{ text }}', b: '{{ text }}' }, { text: 'x'.repeat(131_100) }, standingRenderClock),
    ]).toMatchObject([
      Result.fail({ reason: 'argument', argument: 'a', failure: { reason: 'failed', line: 1 } }),
      Result.fail({ reason: 'argument', argument: 'a', failure: { reason: 'not_text' } }),
      Result.fail({ reason: 'too_large', bytes: 262_215 }),
    ]);
  });

  it('may take what a run may take as its input, so any input a run takes, sent as it is, is arguments a call may send', () => {
    const page = 'x'.repeat(mostInputBytes - JSON.stringify({ page: '' }).length);
    const moment = momentVariables({ page }, '2026-11-10T09:00:00.000Z');

    expect(toolBounds.argumentBytes).toBe(mostInputBytes);
    expect(renderedArguments({ page: '{{ input.page }}' }, moment, standingRenderClock)).toEqual(
      Result.succeed({ input: { page }, bytes: mostInputBytes }),
    );
    expect(renderedArguments({ page: '{{ input.page }}', path: 'a' }, moment, standingRenderClock)).toEqual(
      Result.fail({ reason: 'too_large', bytes: mostInputBytes + 11 }),
    );
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
      renderedArguments({ a: '{{ text }}' }, { text: 'x'.repeat(262_144) }, standingRenderClock),
      renderedArguments({ a: 'At {{ text }}' }, { text: 'x'.repeat(262_144) }, standingRenderClock),
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
      argumentsFailureWords({ reason: 'too_large', bytes: 300_000 }, 'the call'),
      argumentsFailureWords(
        { reason: 'argument', argument: 'a', failure: { reason: 'not_text', line: 1 } },
        'the call',
      ),
      argumentsFailureWords(
        { reason: 'argument', argument: 'a', failure: { reason: 'too_long', line: 1 } },
        'the read',
      ),
      argumentsFailureWords(
        { reason: 'argument', argument: 'a', failure: { reason: 'limit_exceeded', limit: 'time', line: 1 } },
        'the call',
      ),
    ]).toEqual([
      'The arguments of the call take 300000 bytes, more than the 262144 a call may send',
      'The argument a of the call renders a value that is not text among text; write | json after it, or write it alone as one {{ }} to send it as it is',
      'The argument a of the read renders more than the 262144 bytes a call may send',
      'The argument a of the call cannot be rendered within the limits of a template',
    ]);
  });

  it('end with what to do, where the caller gives it, once the arguments or one of them are past what a call may send', () => {
    expect([
      remedied({ reason: 'too_large', bytes: 300_000 }),
      remedied({ reason: 'argument', argument: 'a', failure: { reason: 'too_long', line: 1 } }),
      remedied({ reason: 'argument', argument: 'a', failure: { reason: 'missing_variable', variable: 'b', line: 1 } }),
    ]).toEqual([
      'The arguments of the call take 300000 bytes, more than the 262144 a call may send; give the function a smaller input',
      'The argument a of the call renders more than the 262144 bytes a call may send; give the function a smaller input',
      'The argument a of the call reads a value it does not have',
    ]);
  });
});
