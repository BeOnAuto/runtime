import type { Outcome } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { StartRefused, functionStartAnswered, startAnswered } from './reaction-options.ts';
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

describe('a start of a function host code asked for, as its outcome answered it', () => {
  it('is taken when a run stands under its id, also one that ended unanswered or cancelled, whose ending its own run tells', async () => {
    const outcomes: readonly Outcome[] = [
      { status: 'succeeded', output: {} },
      { status: 'rejected', reason: 'unanswered', detail: 'Nobody could be told', kind: 'undelivered' },
      { status: 'rejected', reason: 'cancelled', detail: 'No longer needed', kind: 'requested' },
    ];

    const answers = await Effect.runPromise(Effect.forEach(outcomes, functionStartAnswered));

    expect(answers).toStrictEqual([undefined, undefined, undefined]);
  });

  it('is refused for now or rejected as a start of a workflow is, for every other outcome', async () => {
    const outcomes: readonly Outcome[] = [
      { status: 'failed', incident: 'i-1' },
      { status: 'rejected', reason: 'conflict', detail: 'The function is paused', kind: 'paused' },
      { status: 'rejected', reason: 'invalid_input', detail: 'The input is not what the function takes' },
    ];

    const failures = await Effect.runPromise(
      Effect.forEach(outcomes, (outcome) => Effect.flip(functionStartAnswered(outcome))),
    );

    expect(failures).toStrictEqual([
      new StartRefused({ detail: 'The start failed with incident i-1' }),
      new StartRejected({ detail: 'The function is paused', kind: 'paused' }),
      new StartRejected({ detail: 'The input is not what the function takes' }),
    ]);
  });
});
