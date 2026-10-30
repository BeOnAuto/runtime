import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { answeringFromTheTools } from './calling-tools.ts';
import { textResult } from './model-results.ts';
import { stepsOf, toolOf } from './step-runs.ts';

describe('a scripted model that answers from what the tools answered', () => {
  it('calls the tools it is given, then answers from their answers in the conversation it is sent', async () => {
    const steps = stepsOf({
      tools: [toolOf('graph', 'search')],
      replies: answeringFromTheTools(
        [
          ['graph__search', { query: 'acme' }],
          ['graph__search', { query: 'globex' }],
        ],
        (texts) => textResult(texts.join(' | ')),
      ),
    });

    expect(await Effect.runPromise(steps.stepping)).toMatchObject({
      ending: { type: 'answered', response: [{ content: [{ type: 'text', text: 'Found 2 rows. | Found 2 rows.' }] }] },
    });
  });
});
