import type { CallResult } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { inputLogOf, responderOf } from './input-log-paths.ts';

const answered: CallResult = { status: 'succeeded', output: 'answered' };

describe('the paths of the input logs', () => {
  it('answer a call whose arguments name no definition as the executor does, rejecting its arguments', () => {
    const respond = responderOf(() => answered);
    const key = { runId: '0199a3c4-7d2e-7c1a-9b3f-000000000300', reference: '/do/0/ask', run: 1 };

    expect(respond({ kind: 'start_call', key, function: 'run_definition', arguments: {}, longestMs: 1 })).toMatchObject(
      {
        result: { status: 'rejected', reason: 'invalid_arguments' },
      },
    );
  });

  it('have no path of a name they do not know', () => {
    expect(() => inputLogOf('missing')).toThrow('No input log path is named missing');
  });
});
