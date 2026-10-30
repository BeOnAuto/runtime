import { playbookOwnNamesOf, eventEmitter, publishedEventOf } from '@on.auto/definitions';
import { Conflict, messageIdOf } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import type { EmitEvent } from '@on.auto/workflow-engine';
import { emitterProbes } from '@on.auto/workflow-engine/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runLogStreamOf } from '../runs/run-address.ts';
import { ledgerEmitter } from './ledger-emitter.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const playbookOwnNames = playbookOwnNamesOf([]);

const run = {
  runId: `acme/alpha/${runId}`,
  attributes: {
    definition: { name: 'close-the-month', version: 2 },
    caller: { id: 'acme-admin' },
    depth: 1,
    lineage: { correlation: 'r-top' },
  },
};

function ticking(): () => number {
  const clock = { now: Date.parse('2026-10-01T09:00:00.000Z') };
  return () => {
    clock.now += 1000;
    return clock.now;
  };
}

describe('the emitter of the host', () => {
  it.each(emitterProbes)('$title', async (probe) => {
    const emitter = ledgerEmitter(eventEmitter(memoryLedger().service, playbookOwnNames), ticking());

    expect(await Effect.runPromise(probe.run({ emitter, run }))).toEqual(probe.expected);
  });
});

const event = {
  specversion: '1.0',
  id: 'e1',
  source: '/acme/ledger',
  type: 'com.acme.closed',
  time: '2026-10-01T09:00:00.000Z',
};

const emission: EmitEvent = {
  kind: 'emit_event',
  key: { runId: run.runId, reference: '/do/0/x', run: 1 },
  event,
};

const origin = { version: 4 };

describe('an event a run of the host emits', () => {
  it('is recorded as the run emitted it, one deeper, caused by the run record and in the chain of the run', async () => {
    const ledger = memoryLedger();
    const emitter = ledgerEmitter(eventEmitter(ledger.service, playbookOwnNames), ticking());

    await Effect.runPromise(emitter.emit(emission, run, origin));
    const { records } = await Effect.runPromise(
      ledger.service.readRecorded(
        { org: 'acme', playbook: 'alpha' },
        { kind: 'everything' },
        { order: 'asc', limit: 10 },
      ),
    );

    expect(records.map((record) => [record.causationId, record.correlationId, publishedEventOf(record)])).toEqual([
      [
        messageIdOf(runLogStreamOf(run.runId), 4),
        'r-top',
        {
          type: 'event_published',
          data: { event, filled: [] },
          context: {
            at: '2026-10-01T09:00:01.000Z',
            by: 'acme-admin',
            runId,
            definitionType: 'workflow',
            definitionName: 'close-the-month',
            definitionVersion: 2,
            depth: 2,
          },
        },
      ],
    ]);
  });
});

describe('an event the ledger cannot record', () => {
  it('fails its emission, to be dispatched again', async () => {
    const emitter = ledgerEmitter(
      () => Effect.fail(new Conflict({ detail: 'The ledger cannot be reached' })),
      ticking(),
    );

    const failure = await Effect.runPromise(Effect.flip(emitter.emit(emission, run, origin)));

    expect(failure).toMatchObject({ output: 'emit_event', detail: 'The ledger cannot be reached' });
  });
});
