import type { Outcome } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { StartRefused, startAnswered } from './reaction-options.ts';
import { StartRejected } from './start-rejected.ts';

describe('a start of a workflow, as its outcome answered it', () => {
  it('is taken when the run started', async () => {
    await expect(Effect.runPromise(startAnswered({ status: 'succeeded', output: {} }))).resolves.toBeUndefined();
  });

  it('is refused for now when the playbook cannot take it now, and rejected when it never will, with the kind and because of its rejection', async () => {
    const outcomes: readonly Outcome[] = [
      { status: 'failed', incident: 'i-1' },
      { status: 'rejected', reason: 'unavailable', detail: 'The meter cannot be reached', kind: 'meter_unavailable' },
      {
        status: 'rejected',
        reason: 'conflict',
        detail: 'The org has used today’s Free credits',
        kind: 'credits_exhausted',
        because: 'free_daily_limit',
      },
      { status: 'rejected', reason: 'invalid_input', detail: 'The input is not what the workflow takes' },
    ];

    const failures = await Effect.runPromise(
      Effect.forEach(outcomes, (outcome) => Effect.flip(startAnswered(outcome))),
    );

    expect(failures).toStrictEqual([
      new StartRefused({ detail: 'The start failed with incident i-1' }),
      new StartRefused({ detail: 'The meter cannot be reached', kind: 'meter_unavailable' }),
      new StartRejected({
        detail: 'The org has used today’s Free credits',
        kind: 'credits_exhausted',
        because: 'free_daily_limit',
      }),
      new StartRejected({ detail: 'The input is not what the workflow takes' }),
    ]);
  });
});
