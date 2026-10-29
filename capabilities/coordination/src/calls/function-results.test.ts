import { describe, expect, it } from 'vitest';

import { definitionRunResultOf } from './function-results.ts';

describe('the result of running a definition through the operations', () => {
  it('is the output of the run that succeeded', () => {
    expect(definitionRunResultOf({ status: 'succeeded', output: { status: 'succeeded', output: { a: 1 } } })).toEqual({
      status: 'succeeded',
      output: { a: 1 },
    });
    expect(definitionRunResultOf({ status: 'succeeded', output: { status: 'succeeded' } })).toEqual({
      status: 'succeeded',
      output: null,
    });
  });

  it('is a wait for a run that finishes later', () => {
    expect(definitionRunResultOf({ status: 'succeeded', output: { status: 'started' } })).toEqual({
      status: 'waiting',
    });
  });

  it('is the rejection, with its issues when it has some', () => {
    expect(definitionRunResultOf({ status: 'rejected', reason: 'forbidden', detail: 'No' })).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'No',
    });
    expect(
      definitionRunResultOf({
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'Wrong',
        issues: [{ detail: 'Expected a string', pointer: '/input' }],
      }),
    ).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'Wrong',
      issues: [{ detail: 'Expected a string', pointer: '/input' }],
    });
  });

  it('is a failure that names the incident of a call that failed', () => {
    expect(definitionRunResultOf({ status: 'failed', incident: 'inc-1' })).toEqual({
      status: 'failed',
      detail: 'The run failed with incident inc-1',
    });
  });
});

describe('the rejection of running a definition that names its kind and because', () => {
  it('is the rejection with its kind and because, which a workflow reads in the error it catches', () => {
    expect(
      definitionRunResultOf({
        status: 'rejected',
        reason: 'unavailable',
        detail: 'A tool server kept failing',
        kind: 'tools_unfinished',
        because: 'server_failed',
      }),
    ).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'A tool server kept failing',
      kind: 'tools_unfinished',
      because: 'server_failed',
    });
  });
});

describe('the refusal of running a definition that names where to put it right', () => {
  it('keeps the link, which the step that waits for credits shows', () => {
    const refused = {
      status: 'rejected',
      reason: 'conflict',
      detail: 'The account has no credits left',
      kind: 'credits_exhausted',
      because: 'none_left',
      resolve_at: 'https://studio.example.com/billing',
    } as const;

    expect(definitionRunResultOf(refused)).toEqual(refused);
  });

  it('keeps when the free rate lifts and why the runtime is limited to it', () => {
    const limited = {
      status: 'rejected',
      reason: 'conflict',
      detail: "This runtime's organization has reached its overage cap of 125 credits.",
      kind: 'credits_exhausted',
      because: 'free_daily_limit',
      resolve_at: 'https://studio.example.com/billing',
      lifts_at: '2026-10-29T00:00:00.000Z',
      limited_because: 'cap',
    } as const;

    expect(definitionRunResultOf(limited)).toEqual(limited);
  });
});
