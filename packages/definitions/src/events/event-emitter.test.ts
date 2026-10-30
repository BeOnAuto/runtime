import { Conflict, Ledger } from '@on.auto/operations';
import { memoryLedger, nothingKept } from '@on.auto/operations/testing';
import { Effect, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { publishedEventPresenter } from '../presenting/published-event-presenter.ts';
import { asking } from '../testing/asking.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { emittedEventsOf, eventEmitter as eventEmitterOf, type Emission } from './event-emitter.ts';
import { publishedEventOf } from './published-events.ts';
import { playbookOwnNamesOf } from './reserved-attributes.ts';

const names = playbookOwnNamesOf([echo, asking]);

const emittedEventRefusal = emittedEventsOf(names).refusalOf;

function eventEmitter(ledger: Parameters<typeof eventEmitterOf>[0]) {
  return eventEmitterOf(ledger, names);
}

const alpha = { org: 'acme', playbook: 'alpha' };

const told: Schema.JsonObject = {
  specversion: '1.0',
  id: '6c1f2a3b-4d5e-5f60-8172-839405a6b7c8',
  source: '/acme/ledger',
  type: 'com.acme.closed',
  time: '2026-10-01T09:00:00.000Z',
  data: { region: 'eu' },
};

function toldWith(attribute: string, value: string | Readonly<Record<string, string>>): Schema.JsonObject {
  return Object.fromEntries([
    ...Object.entries(told).filter(([name]: readonly [string, Schema.Json]) => name !== attribute),
    [attribute, value],
  ]);
}

function emission(event: Schema.Json, at = '2026-10-01T09:00:01.000Z'): Emission {
  return {
    event,
    emitter: { run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', workflow: 'close-the-month', version: 2 },
    depth: 1,
    by: 'acme-admin',
    at,
  };
}

const lineage = { causationId: null, correlationId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' };

describe('an event a workflow emits', () => {
  it('is published once, with which run and workflow emitted it and its reaction depth', async () => {
    const ledger = memoryLedger();
    const emit = eventEmitter(ledger.service);

    const outcomes = await Effect.runPromise(
      Effect.all([
        emit(alpha, emission(told), lineage),
        emit(alpha, emission(told, '2026-10-01T09:00:02.000Z'), lineage),
      ]),
    );
    const { records } = await Effect.runPromise(
      ledger.service.readRecorded(alpha, { kind: 'everything' }, { order: 'asc', limit: 10 }),
    );

    expect(outcomes).toEqual(['recorded', 'already_recorded']);
    expect(records.map((record) => publishedEventOf(record))).toEqual([
      {
        type: 'event_published',
        data: { event: told, filled: [] },
        context: {
          at: '2026-10-01T09:00:01.000Z',
          by: 'acme-admin',
          runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
          definitionType: 'workflow',
          definitionName: 'close-the-month',
          definitionVersion: 2,
          depth: 1,
        },
      },
    ]);
    expect(records.flatMap((record) => publishedEventPresenter.present(record, nothingKept))).toMatchObject([
      { summary: 'The workflow “close-the-month” emitted the event “com.acme.closed”.' },
    ]);
  });
});

describe('an event a workflow emits that the playbook does not record', () => {
  it('is refused, and recorded nowhere, when it is no event the playbook takes or another holds its source and id', async () => {
    const ledger = memoryLedger();
    const emit = eventEmitter(ledger.service);
    await Effect.runPromise(emit(alpha, emission(told), lineage));

    const outcomes = await Effect.runPromise(
      Effect.all([
        emit(alpha, emission(toldWith('type', 'run_succeeded')), lineage),
        emit(alpha, emission(toldWith('type', 'nudge_sent')), lineage),
        emit(alpha, emission(toldWith('source', '')), lineage),
        emit(alpha, emission(toldWith('data', { region: 'us' })), lineage),
      ]),
    );

    expect(outcomes).toEqual(['refused', 'refused', 'refused', 'refused']);
    expect(ledger.streamNames()).toHaveLength(1);
  });

  it('fails while the ledger keeps changing under it, so its output is dispatched again', async () => {
    const changing = Ledger.of({
      ...memoryLedger().service,
      execute: () => Effect.fail(new Conflict({ detail: 'The state changed', kind: 'concurrent_change' })),
    });

    const failure = await Effect.runPromise(Effect.flip(eventEmitter(changing)(alpha, emission(told), lineage)));

    expect(failure).toEqual(new Conflict({ detail: 'The state changed', kind: 'concurrent_change' }));
  });
});

describe('the refusal of an event a workflow would emit', () => {
  it('is none for an event the playbook records, and says where any other breaks its rules', () => {
    expect([
      emittedEventRefusal(told),
      emittedEventRefusal('text'),
      emittedEventRefusal(toldWith('source', 'a b')),
      emittedEventRefusal(toldWith('type', 'reaction_refused')),
    ]).toEqual([
      undefined,
      'Expected object',
      'Expected a URI reference that is not empty, such as /ledger/eu or https://acme.example/ledger (at source)',
      expect.stringMatching(/^Expected a type of your own, not one the playbook records itself: .* \(at type\)$/u),
    ]);
  });
});
