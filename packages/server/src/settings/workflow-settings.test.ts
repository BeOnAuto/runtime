import type { Environment } from '@on.auto/config';
import { describe, expect, it } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';

function errorFrom(environment: Environment): unknown {
  try {
    readSettingsOf(environment);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('the workflow settings', () => {
  it('let a run last 30 days, run 32 calls at once, keep 1000 calls open under a run and sweep every second when nothing is set', () => {
    expect(readSettingsOf({}).workflows).toEqual({
      mostDurationMs: 2_592_000_000,
      mostCallsAtOnce: 32,
      mostOpenCalls: 1000,
      sweepEveryMs: 1000,
    });
  });

  it('read how long a run may last, how many calls run at once, how many stay open and how often the runs are swept', () => {
    const workflows = readSettingsOf({
      WORKFLOW_MAX_DURATION: 'P7D',
      WORKFLOW_NESTED_RUNS: '8',
      WORKFLOW_MAX_OPEN_CALLS: '50',
      WORKFLOW_SWEEP_INTERVAL: 'PT0.25S',
    }).workflows;

    expect(workflows).toEqual({
      mostDurationMs: 604_800_000,
      mostCallsAtOnce: 8,
      mostOpenCalls: 50,
      sweepEveryMs: 250,
    });
  });

  it('stop the server from starting when one is malformed or out of bounds, naming each and never its value', () => {
    const error = errorFrom({
      WORKFLOW_MAX_DURATION: 'secret-forever',
      WORKFLOW_NESTED_RUNS: '1001',
      WORKFLOW_MAX_OPEN_CALLS: '0',
      WORKFLOW_SWEEP_INTERVAL: 'PT2M',
    });

    expect(String(error)).toBe(
      'InvalidSettingsError: The workflow settings are invalid. WORKFLOW_MAX_DURATION: Expected an ISO 8601 duration from PT2H to P365D, such as P30D; WORKFLOW_NESTED_RUNS: Expected a whole number from 1 to 1000, such as 32; WORKFLOW_MAX_OPEN_CALLS: Expected a whole number from 1 to 9999, such as 1000; WORKFLOW_SWEEP_INTERVAL: Expected an ISO 8601 duration from PT0.01S to PT1M, such as PT1S',
    );
  });
});

describe('the most calls open under one run', () => {
  it('take from 1 to 9999, and refuse 10000', () => {
    expect([
      readSettingsOf({ WORKFLOW_MAX_OPEN_CALLS: '1' }).workflows.mostOpenCalls,
      readSettingsOf({ WORKFLOW_MAX_OPEN_CALLS: '9999' }).workflows.mostOpenCalls,
    ]).toEqual([1, 9999]);
    expect(String(errorFrom({ WORKFLOW_MAX_OPEN_CALLS: '10000' }))).toContain(
      'WORKFLOW_MAX_OPEN_CALLS: Expected a whole number from 1 to 9999',
    );
  });
});

describe('a count of calls in the workflow settings', () => {
  it('is refused when it is not a whole number', () => {
    expect(String(errorFrom({ WORKFLOW_NESTED_RUNS: 'many' }))).toContain(
      'WORKFLOW_NESTED_RUNS: Expected a whole number from 1 to 1000',
    );
  });
});
