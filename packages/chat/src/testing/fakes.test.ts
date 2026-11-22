import { describe, expect, it } from 'vitest';

import { MODEL, resultOf, scripted } from './index.ts';

describe('a scripted model', () => {
  it('answers that it has nothing more to say once its script runs out', async () => {
    const { model, requests } = scripted();
    const request = {
      model: MODEL,
      messages: [],
      output: { type: 'text' },
      settings: { max_output_tokens: 1 },
    } as const;
    expect(await model.generate(request)).toEqual(resultOf('Nothing more to say'));
    expect(requests).toEqual([request]);
  });
});
