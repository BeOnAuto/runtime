import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { IncompleteDetailsSchema, IncompleteReasonSchema } from '../index.ts';

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
