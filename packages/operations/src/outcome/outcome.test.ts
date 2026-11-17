import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  IncompleteDetailsSchema,
  IncompleteReasonSchema,
  isKindWithType,
  kindsWithTypes,
  problemTypeOf,
  reasonOfKind,
} from '../index.ts';
import { cappedOptions } from './outcome.ts';

describe('the options a refusal offers', () => {
  it('keep the question and every choice, each choice with at most one hundred issues of a detail and a pointer', () => {
    const issues = Array.from({ length: 150 }, (_unused, index) => ({
      detail: 'Write it',
      pointer: `/lines/${index}`,
      line: index,
    }));

    expect(cappedOptions({ question: 'Which way?', choices: [{ value: 'one', title: 'One', issues }] })).toEqual({
      question: 'Which way?',
      choices: [
        {
          value: 'one',
          title: 'One',
          issues: Array.from({ length: 100 }, (_unused, index) => ({ detail: 'Write it', pointer: `/lines/${index}` })),
        },
      ],
    });
  });
});

const decodeDetails = Schema.decodeUnknownResult(IncompleteDetailsSchema, { onExcessProperty: 'error' });

describe('the details of a run that succeeded with an answer a limit shaped', () => {
  it.each(['max_tool_calls', 'max_input_tokens', 'max_output_tokens'])('name the limit %s it reached', (reason) => {
    expect(Result.getOrThrow(decodeDetails({ reason }))).toEqual({ reason });
  });

  it('name no limit by another word, and hold the reason alone', () => {
    const offered: readonly unknown[] = [
      { reason: 'max_prompt_tokens' },
      { reason: 'length' },
      {},
      { reason: 'max_tool_calls', count: 25 },
    ];

    expect(offered.map((details: unknown) => Result.isFailure(decodeDetails(details)))).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it('name the three limits a run may answer at, in the order a reference lists them', () => {
    expect(IncompleteReasonSchema.literals).toEqual(['max_tool_calls', 'max_input_tokens', 'max_output_tokens']);
  });
});

describe('the types of problems', () => {
  it('are URIs under https://on.auto/problems/', () => {
    expect(problemTypeOf('unavailable')).toBe('https://on.auto/problems/unavailable');
  });

  it('give tools_unfinished, tools_called, effect_unknown, the meter’s four refusals and cursor_not_held types of their own, and no other kind', () => {
    expect(kindsWithTypes).toEqual([
      'tools_unfinished',
      'tools_called',
      'effect_unknown',
      'credits_exhausted',
      'license_required',
      'license_invalid',
      'account_closed',
      'cursor_not_held',
    ]);
    expect([
      isKindWithType('tools_unfinished'),
      isKindWithType('tools_called'),
      isKindWithType('effect_unknown'),
      isKindWithType('credits_exhausted'),
      isKindWithType('account_closed'),
      isKindWithType('cursor_not_held'),
      isKindWithType('stalled'),
      isKindWithType('tool_not_offered'),
      isKindWithType('toString'),
      isKindWithType(),
    ]).toEqual([true, true, true, true, true, true, false, false, false, false]);
  });

  it('keep the reason of each kind with a type of its own', () => {
    expect(kindsWithTypes.map((kind) => reasonOfKind(kind))).toEqual([
      'unavailable',
      'conflict',
      'conflict',
      'conflict',
      'conflict',
      'conflict',
      'conflict',
      'invalid_input',
    ]);
  });
});
