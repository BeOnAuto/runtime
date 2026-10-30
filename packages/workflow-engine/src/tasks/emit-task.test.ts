import { describe, expect, it } from 'vitest';

import type { EmitEvent } from '../dispatch/run-output.ts';
import type { JsonObject } from '../dsl/json.ts';
import { mostEmittedEvents } from '../machine/limits.ts';
import { isoInstantOf } from '../machine/utc-time.ts';
import { testDriverOf } from '../pool-testing/test-sandbox.ts';
import { testSettings } from '../testing/driver-inputs.ts';
import { drivenRunId, drivenRun, outputsIn } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';
import { emittedEventIdOf } from './emit-task.ts';

function emissionsIn(run: ReturnType<typeof drivenRun>): readonly EmitEvent[] {
  return outputsIn(run.events).filter((output): output is EmitEvent => output.kind === 'emit_event');
}

function refusingReserved(event: JsonObject): string | undefined {
  return event['type'] === 'reserved' ? 'The type reserved is the playbook’s own' : undefined;
}

describe('an emit task', () => {
  it('emits the event it is given, with an id of its call and the time of its input, and hands its input on', () => {
    const run = drivenRun(
      workflow(`
do:
  - announce:
      emit:
        event:
          with: { type: com.acme.closed, source: /acme/ledger, subject: '\${ $data.month }', data: { total: '\${ $data.total }' } }
`),
      { input: { month: 'september', total: 12 } },
    );
    const key = { runId: drivenRunId, reference: '/do/0/announce', run: 1 };

    expect(run.outcome).toEqual({ kind: 'completed', output: { month: 'september', total: 12 } });
    expect(emissionsIn(run)).toEqual([
      {
        kind: 'emit_event',
        key,
        event: {
          type: 'com.acme.closed',
          source: '/acme/ledger',
          subject: 'september',
          data: { total: 12 },
          specversion: '1.0',
          id: emittedEventIdOf(key),
          time: isoInstantOf(run.ended.startedAt),
        },
      },
    ]);
    expect(run.ended.emitted.count).toBe(1);
  });

  it('gives each run of the task an id of its own, the same however often the run is decided', () => {
    const loop = workflow(`
do:
  - each:
      for: { in: '\${ [1, 2] }' }
      do:
        - announce: { emit: { event: { with: { type: tick, source: /loop, time: '2026-10-01T09:00:00Z' } } } }
`);

    const [first, again] = [drivenRun(loop), drivenRun(loop)].map((run) =>
      emissionsIn(run).map(({ event }) => event['id']),
    );

    expect(first).toEqual(again);
    expect(new Set(first).size).toBe(2);
  });
});

describe('an emit task that cannot emit', () => {
  it('raises a validation error for an event without a type or a source, with an id, or too large', () => {
    const tasks = [
      "{ emit: { event: { with: { type: '${ 1 }', source: /a } } } }",
      "{ emit: { event: { with: { type: t, source: ' ' } } } }",
      '{ emit: { event: { with: { type: t, source: /a, id: \'${ "e1" }\' } } } }',
      '{ emit: { event: { with: { type: t, source: /a, data: \'${ "x".repeat(250000) }\' } } } }',
    ];

    const outcomes = tasks.map((task) => drivenRun(workflow(`do:\n  - announce: ${task}`)).outcome);

    expect(outcomes).toMatchObject(Array.from({ length: 4 }, () => ({ kind: 'raised', error: { status: 400 } })));
  });

  it('raises the refusal of the functions it is given, for an event they do not take', () => {
    const driver = testDriverOf({
      machine: { ...testSettings, functions: { ...testSettings.functions, emitRefusal: refusingReserved } },
    });
    driver.start({
      runId: drivenRunId,
      document: workflow('do:\n  - announce: { emit: { event: { with: { type: reserved, source: /a } } } }'),
    });

    expect(driver.runUntilEnded(drivenRunId).outcome).toMatchObject({
      kind: 'raised',
      error: { status: 400, title: 'The type reserved is the playbook’s own' },
    });
  });
});

describe('the events a run emits', () => {
  it('counts toward the events a run emits over its life, and the one past the bound raises', () => {
    const run = drivenRun(
      workflow(`
do:
  - each:
      for: { in: '\${ Array.from({ length: ${mostEmittedEvents + 1} }, (_, index) => index) }' }
      do:
        - announce: { emit: { event: { with: { type: tick, source: /loop } } } }
`),
    );

    expect(run.outcome).toMatchObject({ kind: 'raised', error: { status: 500 } });
    expect(emissionsIn(run)).toHaveLength(mostEmittedEvents);
  });

  it('counts the bytes of the events a run emits over its life, and the event past them raises', () => {
    const run = drivenRun(
      workflow(`
do:
  - each:
      for: { in: '\${ Array.from({ length: 18 }, (_, index) => index) }' }
      do:
        - announce: { emit: { event: { with: { type: tick, source: /loop, data: '\${ "x".repeat(240000) }' } } } }
        - pause: { wait: PT1S }
`),
    );

    expect(run.outcome).toMatchObject({ kind: 'raised', error: { status: 500 } });
    expect(emissionsIn(run)).toHaveLength(17);
  });
});
