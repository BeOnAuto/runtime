import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { CallBlockSchema, ToolUseSchema } from './call-block-schemas.ts';

const decodeCall = Schema.decodeUnknownResult(CallBlockSchema);

const decodeToolUse = Schema.decodeUnknownResult(ToolUseSchema);

describe('a call block', () => {
  it('names a server and a tool, and may give arguments and a pointer to read', () => {
    const written = {
      server: 'chat',
      tool: 'thread',
      with: { limit: 100, channel: '{{ input.channel }}' },
      read: '/messages',
    };

    expect([decodeCall(written), decodeCall({ server: 'chat', tool: 'thread' })]).toEqual([
      Result.succeed(written),
      Result.succeed({ server: 'chat', tool: 'thread' }),
    ]);
  });

  it('refuses a block without its tool, or a pointer that is not text', () => {
    expect([
      Result.isFailure(decodeCall({ server: 'chat' })),
      Result.isFailure(decodeCall({ server: 'chat', tool: 'thread', read: 7 })),
    ]).toEqual([true, true]);
  });
});

describe('the use of a tool another block makes', () => {
  it('always gives the arguments it sends', () => {
    expect([
      Result.isSuccess(decodeToolUse({ server: 'chat', tool: 'post_message', with: {} })),
      Result.isFailure(decodeToolUse({ server: 'chat', tool: 'post_message' })),
    ]).toEqual([true, true]);
  });
});
