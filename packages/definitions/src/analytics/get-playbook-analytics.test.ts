import type { Context, Decider } from '@on.auto/operations';
import { Effect, Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineGetPlaybookAnalytics } from '../index.ts';
import { RunEventSchema, type RecordedRunEvent, type RunEvent } from '../runs/run-events.ts';
import type { RunRejection } from '../runs/run.ts';
import { acmeReader, recordedAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { asQueryString, harness, toPlaybook, type Harness } from '../testing/harness.ts';

const getPlaybookAnalytics = defineGetPlaybookAnalytics([
  echo,
  { ...echo, type: 'reasoning' },
  { ...echo, type: 'workflow' },
]);

interface Writing {
  readonly event: RunEvent;
  readonly context: Context;
}

const runEvents: Decider<null, Writing, RecordedRunEvent> = {
  initialState: null,
  evolve: () => null,
  decide: ({ event }) => Result.succeed([event]),
  context: ({ context }) => context,
  eventSchema: RunEventSchema,
};

const now = '2026-10-06T12:00:00.000Z';

function ofTheRun(name: string, type: string, at: string) {
  return {
    at,
    by: 'acme-admin',
    runId: `run-of-${name}`,
    definitionType: type,
    definitionName: name,
    definitionVersion: 1,
  };
}

const usage = { input: { total: 1200, cache_read: 1000 }, output: { total: 300 } };

function started(name: string, at: string, type = 'reasoning'): Writing {
  return {
    event: { type: 'run_started', data: { started_by: recordedAdmin, input: {} } },
    context: ofTheRun(name, type, at),
  };
}

function succeeded(at: string, record: Schema.JsonObject = {}, name = 'triage', type = 'reasoning'): Writing {
  return { event: { type: 'run_succeeded', data: { output: 'ok', record } }, context: ofTheRun(name, type, at) };
}

function running(definitions: Harness, stream: string, ...events: readonly Writing[]): Promise<unknown> {
  return Effect.runPromise(
    Effect.forEach(events, (event) => definitions.ledger.service.execute(stream, runEvents, event)),
  );
}

async function aPlaybookWithRuns(): Promise<Harness> {
  const definitions = harness();
  const rejection: RunRejection = { reason: 'unavailable', detail: 'The answer is not JSON' };
  await running(
    definitions,
    'playbook/acme/alpha/runs/r1',
    started('triage', '2026-10-05T09:00:00.000Z'),
    succeeded('2026-10-05T09:00:01.000Z', { usage }),
  );
  await running(definitions, 'playbook/acme/alpha/runs/r2', started('triage', '2026-10-05T10:00:00.000Z'), {
    event: {
      type: 'run_rejected',
      data: { rejection, record: { usage: { input: { total: 10, cache_read: 0 }, output: { total: 2 } } } },
    },
    context: ofTheRun('triage', 'reasoning', '2026-10-05T10:00:00.500Z'),
  });
  await running(
    definitions,
    'playbook/acme/alpha/runs/r3',
    started('approval', '2026-10-06T08:00:00.000Z', 'workflow'),
    succeeded('2026-10-06T08:00:02.000Z', {}, 'approval', 'workflow'),
  );
  await running(definitions, 'playbook/acme/alpha/runs/r4', started('draft', '2026-10-06T09:00:00.000Z'));
  await running(
    definitions,
    'playbook/acme/alpha/runs/r5',
    started('triage', '2026-09-20T09:00:00.000Z'),
    succeeded('2026-09-20T09:00:00.400Z'),
  );
  await running(definitions, 'playbook/acme/beta/runs/r6', started('triage', '2026-10-06T09:00:00.000Z'));
  return definitions;
}

const toAlpha = toPlaybook('acme', 'alpha');

function quietDay(day: string) {
  const runs = { total: 0, succeeded: 0, failed: 0, rejected: 0 };
  return { day, runs, tokens: { input: 0, output: 0, cached: 0 }, duration_ms: null };
}

const schemaRefusals: readonly (readonly [Readonly<Record<string, unknown>>, string])[] = [
  [{ days: 8 }, '/days'],
  [{ days: '7' }, '/days'],
  [{ from: '2026-02-30', to: '2026-03-01' }, '/from'],
  [{ from: '2026-10-01', to: '2026-10-6' }, '/to'],
  [{ from: '2026-10-01T24:00:00Z', to: '2026-10-02' }, '/from'],
  [{ since: '2026-10-01T00:00:00Z' }, '/since'],
  [{ type: 'prediction' }, '/type'],
];

describe('get_playbook_analytics', () => {
  it('is a playbook query at GET /analytics, served over HTTP alone', () => {
    expect(getPlaybookAnalytics.registration).toMatchObject({
      scope: 'playbook',
      kind: 'query',
      route: { method: 'GET', path: '/analytics' },
      reasons: ['invalid_input'],
      servedOverHttpAlone: { kind: 'none' },
    });
  });

  it('answers the last seven days by default, with every day, the runs that ended and what they used', async () => {
    const definitions = await aPlaybookWithRuns();

    const read = await definitions.call(getPlaybookAnalytics, toAlpha(acmeReader), now);

    expect(read).toEqual({
      status: 'succeeded',
      output: {
        days: 7,
        runs: { total: 3, succeeded: 2, failed: 0, rejected: 1 },
        tokens: { input: 1210, output: 302, cached: 1000 },
        duration_ms: { p50: 1000, p95: 2000 },
        by_day: [
          ...['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map((day) => quietDay(day)),
          {
            day: '2026-10-05',
            runs: { total: 2, succeeded: 1, failed: 0, rejected: 1 },
            tokens: { input: 1210, output: 302, cached: 1000 },
            duration_ms: { p50: 1000, p95: 1000 },
          },
          {
            day: '2026-10-06',
            runs: { total: 1, succeeded: 1, failed: 0, rejected: 0 },
            tokens: { input: 0, output: 0, cached: 0 },
            duration_ms: { p50: 2000, p95: 2000 },
          },
        ],
        by_function: [
          { type: 'reasoning', name: 'triage', runs: 2 },
          { type: 'workflow', name: 'approval', runs: 1 },
        ],
      },
    });
  });
});

describe('get_playbook_analytics, asked for some days or some runs', () => {
  it('reads the last 30 days, or the days between two, and keeps the runs of one type or name', async () => {
    const definitions = await aPlaybookWithRuns();
    const reading = (input: object) => definitions.call(getPlaybookAnalytics, toAlpha(acmeReader, input), now);

    const answers = await Promise.all([
      reading({ days: 30 }),
      reading({ from: '2026-10-06', to: '2026-10-06' }),
      reading({ type: 'workflow' }),
      reading({ type: 'reasoning', name: 'triage', days: 30 }),
      definitions.call(getPlaybookAnalytics, asQueryString(toAlpha(acmeReader, { days: '14', name: 'approval' })), now),
    ]);

    expect(answers).toMatchObject([
      { output: { days: 30, runs: { total: 4 }, duration_ms: { p50: 1000, p95: 2000 } } },
      { output: { days: 1, runs: { total: 1 }, by_day: [{ day: '2026-10-06' }] } },
      { output: { runs: { total: 1 }, by_function: [{ type: 'workflow', name: 'approval' }] } },
      { output: { runs: { total: 3 }, by_function: [{ name: 'triage', runs: 3 }] } },
      { output: { days: 14, runs: { total: 1 }, by_function: [{ name: 'approval' }] } },
    ]);
  });
});

describe('get_playbook_analytics, given what it cannot answer', () => {
  it.each(schemaRefusals)('refuses %j as input that does not match its schema', async (input, pointer) => {
    const definitions = harness();

    expect(await definitions.call(getPlaybookAnalytics, toAlpha(acmeReader, input), now)).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer }],
    });
  });

  it('refuses days with from, a day after today, and a playbook it does not have', async () => {
    const definitions = harness();

    const answers = await Promise.all([
      definitions.call(getPlaybookAnalytics, toAlpha(acmeReader, { days: 7, from: '2026-10-01' }), now),
      definitions.call(getPlaybookAnalytics, toAlpha(acmeReader, { from: '2026-10-01', to: '2026-10-07' }), now),
      definitions.call(getPlaybookAnalytics, toPlaybook('acme', 'zeta')(acmeReader), now),
    ]);

    expect(answers).toEqual([
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The days asked for are not a window this playbook can answer',
        issues: [{ pointer: '/days', detail: 'Expected days, or from and to, not both' }],
      },
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The days asked for are not a window this playbook can answer',
        issues: [{ pointer: '/to', detail: 'Expected a day no later than today, 2026-10-06, in UTC' }],
      },
      { status: 'rejected', reason: 'not_found', detail: 'There is no playbook zeta in this org' },
    ]);
  });
});
