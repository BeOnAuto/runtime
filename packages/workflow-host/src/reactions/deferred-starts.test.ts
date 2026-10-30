import { recordingTracer } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { onSQLite, openedOn } from '../testing/host-files.ts';
import type { ReactionStart } from './reaction-options.ts';
import { refusalsOn } from './refusals.ts';
import { mostStartsAMinute, startingOn } from './start-rates.ts';

const playbookKey = 'playbook/acme/alpha/';

const minute = Date.parse('2026-10-01T09:00:00.000Z');

const trace = { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7' };

function startNumber(index: number): ReactionStart {
  return {
    org: 'acme',
    playbook: 'alpha',
    workflow: 'close',
    version: 1,
    runId: `run-${index}`,
    input: [],
    depth: 1,
    cause: `record-${index}`,
    trigger: { kind: 'event', reference: '/schedule/on' },
    trace,
  };
}

describe('a start that waited for a later minute', () => {
  it('is a span when it is taken up, linked to the trace of the record that matched its trigger', async () => {
    const time = { now: minute + 1000 };
    const database = await openedOn(await onSQLite());
    const starting = startingOn(
      database,
      () => Effect.void,
      refusalsOn(database, () => time.now),
      () => time.now,
    );
    const recording = recordingTracer();
    await Effect.runPromise(
      Effect.forEach(
        Array.from({ length: mostStartsAMinute + 1 }, (_, index) => startNumber(index)),
        (start) => starting.start(playbookKey, start),
        { discard: true },
      ),
    );

    time.now = minute + 60_000;
    await Effect.runPromise(Effect.withTracer(starting.startDeferred(), recording.tracer));

    expect(recording.spans()).toMatchObject([
      {
        name: 'deferred_start',
        attributes: {
          'auto.on.org': 'acme',
          'auto.on.playbook': 'alpha',
          'auto.on.run_id': 'run-60',
          'auto.on.workflow': 'close',
          'auto.on.trigger.kind': 'event',
        },
        links: [trace],
      },
    ]);
  });
});
