import type { Context, ProjectedMessage, RunOutcome } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { runOutcomeMapping } from './run-outcome-mapping.ts';

function messageOf(type: string, data: unknown, context: Context): ProjectedMessage {
  return { id: 'm-1', position: 1, type, data, context };
}

function runContextAt(at: string, name = 'triage', type = 'reasoning'): Context {
  return { at, by: 'acme-admin', runId: 'run-1', definitionType: type, definitionName: name, definitionVersion: 1 };
}

const startedBy = { id: 'acme-admin', name: 'Acme Admin' };

function startedAt(at: string, name = 'triage', type = 'reasoning'): ProjectedMessage {
  return messageOf('run_started', { input: {}, started_by: startedBy }, runContextAt(at, name, type));
}

function endedAt(at: string, type: string, data: object = {}): ProjectedMessage {
  return messageOf(type, data, runContextAt(at));
}

const usage = {
  input: { total: 1200, uncached: 200, cache_read: 1000, cache_write: 0 },
  output: { total: 300, text: 250, reasoning: 50 },
  total: 1500,
};

function keptAfter(...messages: readonly ProjectedMessage[]): RunOutcome | undefined {
  let row: RunOutcome | undefined;
  for (const message of messages) {
    row = runOutcomeMapping.rowAfter(row, message) ?? row;
  }
  return row;
}

const started = startedAt('2026-10-01T09:00:00.000Z');

const firstStart = {
  startedDay: '2026-10-01',
  startedAt: '2026-10-01T09:00:00.000Z',
  lastStartedAt: '2026-10-01T09:00:00.000Z',
  definitionType: 'reasoning',
  name: 'triage',
};

const noTokens = { inputTokens: null, outputTokens: null, cachedTokens: null };

describe('the outcome of a run', () => {
  it('reads the types of the run events that change it', () => {
    expect(runOutcomeMapping.types).toEqual(['run_started', 'run_succeeded', 'run_failed', 'run_rejected']);
  });

  it('is started from its first start, with the definition of its context', () => {
    expect(keptAfter(started)).toEqual({ ...firstStart, status: 'started', durationMs: null, ...noTokens });
  });
});

describe('the outcome of a run that ended', () => {
  it('takes the tokens a reasoning run recorded and its duration from start to end when it succeeds', () => {
    const succeeded = endedAt('2026-10-01T09:00:01.250Z', 'run_succeeded', {
      output: 'ok',
      record: { usage, duration_ms: 900 },
    });

    expect(keptAfter(started, succeeded)).toEqual({
      ...firstStart,
      status: 'succeeded',
      durationMs: 1250,
      inputTokens: 1200,
      outputTokens: 300,
      cachedTokens: 1000,
    });
  });

  it('takes the duration of a workflow run, whose record holds no tokens', () => {
    const workflow = startedAt('2026-10-01T09:00:00.000Z', 'approval', 'workflow');
    const deferred = endedAt('2026-10-01T09:00:00.100Z', 'run_deferred', { record: { run: 'r1' } });
    const succeeded = endedAt('2026-10-02T09:00:00.000Z', 'run_succeeded', { output: {}, record: {} });

    expect(keptAfter(workflow, deferred, succeeded)).toEqual({
      ...firstStart,
      definitionType: 'workflow',
      name: 'approval',
      status: 'succeeded',
      durationMs: 86_400_000,
      ...noTokens,
    });
  });

  it('takes the duration of a failed run, with no tokens', () => {
    expect(keptAfter(started, endedAt('2026-10-01T09:00:02.000Z', 'run_failed'))).toEqual({
      ...firstStart,
      status: 'failed',
      durationMs: 2000,
      ...noTokens,
    });
  });
});

describe('the outcome of a rejected run', () => {
  it('counts the tokens of a rejected run that recorded them, never a duration', () => {
    const rejection = { reason: 'unavailable', detail: 'The answer is not JSON' };
    const at = '2026-10-01T09:00:03.000Z';

    expect([
      keptAfter(started, endedAt(at, 'run_rejected', { rejection, record: { usage } })),
      keptAfter(started, endedAt(at, 'run_rejected', { rejection })),
    ]).toEqual([
      { ...firstStart, status: 'rejected', durationMs: null, inputTokens: 1200, outputTokens: 300, cachedTokens: 1000 },
      { ...firstStart, status: 'rejected', durationMs: null, ...noTokens },
    ]);
  });
});

function spent(input: number, output: number) {
  return { usage: { input: { total: input }, output: { total: output } } };
}

describe('the outcome of a run started again or measured oddly', () => {
  it('keeps its first start when started again, and measures the attempt started last', () => {
    const failed = endedAt('2026-10-01T09:01:00.000Z', 'run_failed');
    const again = startedAt('2026-10-02T10:00:00.000Z', 'renamed');
    const succeeded = endedAt('2026-10-02T10:00:05.000Z', 'run_succeeded', { output: 'ok', record: {} });

    expect([keptAfter(started, failed, again), keptAfter(started, failed, again, succeeded)]).toEqual([
      { ...firstStart, lastStartedAt: '2026-10-02T10:00:00.000Z', status: 'started', durationMs: null, ...noTokens },
      { ...firstStart, lastStartedAt: '2026-10-02T10:00:00.000Z', status: 'succeeded', durationMs: 5000, ...noTokens },
    ]);
  });

  it('adds up the tokens of every attempt, while it measures the last one alone', () => {
    const rejected = endedAt('2026-10-01T09:00:02.000Z', 'run_rejected', {
      rejection: { reason: 'unavailable', detail: 'The answer is not JSON' },
      record: spent(500, 40),
    });
    const again = startedAt('2026-10-01T10:00:00.000Z');
    const succeeded = endedAt('2026-10-01T10:00:00.300Z', 'run_succeeded', { output: 'ok', record: spent(100, 10) });

    expect([keptAfter(started, rejected, again), keptAfter(started, rejected, again, succeeded)]).toMatchObject([
      { status: 'started', inputTokens: 500, outputTokens: 40, cachedTokens: null },
      { status: 'succeeded', durationMs: 300, inputTokens: 600, outputTokens: 50, cachedTokens: null },
    ]);
  });
});

describe('the outcome of a run with a finish it cannot measure', () => {
  it('is kept with the day of its finish when the finish comes without a start', () => {
    expect(keptAfter(endedAt('2026-10-03T23:59:59.999Z', 'run_failed'))).toEqual({
      startedDay: '2026-10-03',
      startedAt: '2026-10-03T23:59:59.999Z',
      lastStartedAt: '2026-10-03T23:59:59.999Z',
      definitionType: '',
      name: '',
      status: 'failed',
      durationMs: null,
      ...noTokens,
    });
  });

  it('takes no duration from a row whose start it cannot read', () => {
    const row: RunOutcome = {
      ...firstStart,
      lastStartedAt: 'not a time',
      status: 'started',
      durationMs: null,
      ...noTokens,
    };

    expect(runOutcomeMapping.rowAfter(row, endedAt('2026-10-01T09:00:01.000Z', 'run_failed'))).toMatchObject({
      status: 'failed',
      durationMs: null,
    });
  });

  it('takes no duration below zero, when a finish is recorded before its start by another clock', () => {
    expect(keptAfter(started, endedAt('2026-10-01T08:59:59.000Z', 'run_failed'))).toMatchObject({ durationMs: 0 });
  });
});

const notTokens: readonly unknown[] = [
  { usage: 'none' },
  { usage: { input: { total: '12', cache_read: -1 }, output: { total: 2.5 } } },
  { usage: { input: { total: Number.MAX_SAFE_INTEGER + 2 }, output: null } },
  { usage: { input: [12] } },
];

const notRunEvents: readonly ProjectedMessage[] = [
  startedAt('not a time'),
  endedAt('not a time', 'run_failed'),
  endedAt('2026-10-01T09:00:00.000Z', 'run_deferred', { record: {} }),
  endedAt('2026-10-01T09:00:00.000Z', 'tool_call_started'),
];

const { definitionName: _name, ...withoutItsDefinition } = runContextAt('2026-10-01T09:00:00.000Z');

const unreadableRunEvents: readonly (readonly [ProjectedMessage, string])[] = [
  [
    messageOf('run_started', { input: {}, started_by: startedBy }, withoutItsDefinition),
    'Missing key\n  at ["context"]["definitionName"]',
  ],
  [
    messageOf('run_started', { input: {} }, runContextAt('2026-10-01T09:00:00.000Z')),
    'Missing key\n  at ["data"]["started_by"]',
  ],
  [endedAt('2026-10-01T09:00:00.000Z', 'run_succeeded', { output: 'ok' }), 'Missing key\n  at ["data"]["record"]'],
  [
    endedAt('2026-10-01T09:00:00.000Z', 'run_succeeded', { output: 'ok', record: 'a record that is text' }),
    'Expected object\n  at ["data"]["record"]',
  ],
  [
    messageOf('run_succeeded', 'not a fact', runContextAt('2026-10-01T09:00:00.000Z')),
    'Expected object\n  at ["data"]',
  ],
];

describe('what the outcome of a run leaves as it is', () => {
  it.each(notTokens)('is the tokens of a record that holds no counts, %j', (record) => {
    const succeeded = endedAt('2026-10-01T09:00:01.000Z', 'run_succeeded', { output: 'ok', record });

    expect(keptAfter(started, succeeded)).toMatchObject(noTokens);
  });

  it.each(notRunEvents)('is the row, for an event it does not measure, %j', (message) => {
    const row = keptAfter(started);

    expect([runOutcomeMapping.rowAfter(row, message), runOutcomeMapping.rowAfter(undefined, message)]).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe('what the outcome of a run refuses', () => {
  it.each(unreadableRunEvents)('is a fact of the run in a shape no reader of the run knows, %j', (message, refusal) => {
    expect(() => runOutcomeMapping.rowAfter(keptAfter(started), message)).toThrow(refusal);
  });
});
