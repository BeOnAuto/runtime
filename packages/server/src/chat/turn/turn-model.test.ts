import { mostListingBytes } from '@on.auto/api';
import { INSTRUCTIONS_ALLOWANCE_BYTES, MEMORY_BOUNDS, TURN_BOUNDS } from '@on.auto/chat';
import { describe, expect, it } from 'vitest';

import { modelsFake } from '../../testing/chat/chat-fakes.ts';
import { boundsFor, modelOfATurn } from './turn-model.ts';

describe('the bounds of a turn, cut to the chosen model', () => {
  it.each([
    ['a model that reports nothing', {}, TURN_BOUNDS.requestInputTokens, TURN_BOUNDS.outputTokens],
    ['a model with a smaller window', { contextWindow: 100_000 }, 100_000 - TURN_BOUNDS.outputTokens, 16_000],
    ['a model that writes less', { mostOutputTokens: 4_000 }, TURN_BOUNDS.requestInputTokens, 4_000],
    [
      'a model with a larger window and output',
      { contextWindow: 1_000_000, mostOutputTokens: 64_000 },
      180_000,
      16_000,
    ],
    ['a small model', { contextWindow: 32_000, mostOutputTokens: 8_000 }, 24_000, 8_000],
  ] as const)('take the defaults or less for %s', (_, limits, requestInputTokens, outputTokens) => {
    expect(boundsFor(limits).bounds).toEqual({ requestInputTokens, outputTokens });
  });

  it('derive the budget of the conversation again from the bound of a request, so one full window fits', () => {
    const { bounds, memory } = boundsFor({ contextWindow: 64_000, mostOutputTokens: 8_000 });

    expect(memory.conversationBytes + mostListingBytes.directory + INSTRUCTIONS_ALLOWANCE_BYTES).toBe(
      bounds.requestInputTokens,
    );
    expect([memory.rows, memory.threadMessages]).toEqual([MEMORY_BOUNDS.rows, MEMORY_BOUNDS.threadMessages]);
    expect(boundsFor({}).memory.conversationBytes).toBe(MEMORY_BOUNDS.conversationBytes);
  });
});

function chosenOf(turn: Awaited<ReturnType<typeof modelOfATurn>>): readonly (string | number)[] {
  return 'chosen' in turn ? [turn.chosen.model.name, turn.chosen.bounds.outputTokens] : [];
}

describe('the model of a turn', () => {
  it('is none until one is chosen, and none where the server no longer offers the one chosen', async () => {
    expect([
      await modelOfATurn(modelsFake().models, null),
      await modelOfATurn(modelsFake({ refusal: 'not offered' }).models, 'provider/gone'),
    ]).toEqual([{ unavailable: 'unchosen' }, { unavailable: 'not_offered' }]);
  });

  it('is the chosen one, named as chosen and bounded by what it reports', async () => {
    const turn = await modelOfATurn(modelsFake({ limits: { mostOutputTokens: 2_000 } }).models, 'provider/model');

    expect(chosenOf(turn)).toEqual(['provider/model', 2_000]);
  });
});
