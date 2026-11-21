import { eventEmitter, playbookOwnNamesOf, publishedEventOf } from '@on.auto/definitions';
import { Conflict, messageIdOf } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { type EmitEvent, emittedEventIdOf } from '@on.auto/workflow-engine';
import { emitterProbes } from '@on.auto/workflow-engine/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runsOfAlpha } from '../payload-testing/kept-payloads.ts';
import { emittingInto, publishedEventIdsIn } from '../reaction-testing/ledger-emissions.ts';
import { movedClock } from '../reaction-testing/moved-clock.ts';
import { at, definitionRecorded, eventTrigger } from '../reaction-testing/playbook-writes.ts';
import { reactingHost } from '../reaction-testing/reacting-host.ts';
import { runLogStreamOf } from '../runs/run-address.ts';
import { definitionOfTheTests, runAt, startOf, workflow } from '../testing/host-documents.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { ledgerEmitter } from './ledger-emitter.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c';

const ticking = workflow(`do:
  - each:
      for: { in: '\${ [1, 2] }' }
      do:
        - tick: { emit: { event: { with: { type: com.acme.ticked, source: /acme/clock } } } }
`);

const announcing = workflow(`do:
  - notify: { call: notify, with: { to: ada } }
  - announce: { emit: { event: { with: { type: com.acme.closed, source: /acme/ledger, data: { month: september } } } } }
`);

const runIdLedgerEmitter = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const playbookOwnNames = playbookOwnNamesOf([]);

const run = {
  runId: `acme/alpha/${runIdLedgerEmitter}`,
  attributes: {
    definition: { name: 'close-the-month', version: 2 },
    caller: { id: 'acme-admin' },
    depth: 1,
    lineage: { correlation: 'r-top' },
  },
};

function tickingLedgerEmitter(): () => number {
  const clock = { now: Date.parse('2026-10-01T09:00:00.000Z') };
  return () => {
    clock.now += 1000;
    return clock.now;
  };
}

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

describe('a workflow run by the host that emits an event', () => {
  it('hands the event to the playbook as emitted by the run and its workflow, one deeper than the run', async () => {
    const reacting = await reactingHost();
    const start = startOf(announcing);
    const attributes = { ...start.attributes, definition: { name: 'close', version: 3 }, caller: { id: 'acme-admin' } };

    await Effect.runPromise(reacting.host.start(runAt(runId), { ...start, attributes }));
    const emissions = await reacting.whenRead(
      () => Promise.resolve(reacting.reactions.emissions()),
      (found) => found.length > 0,
    );

    expect(emissions).toMatchObject([
      {
        event: { type: 'com.acme.closed', source: '/acme/ledger', data: { month: 'september' } },
        emitter: { run_id: runId, workflow: 'close', version: 3 },
        depth: 1,
        by: 'acme-admin',
      },
    ]);
  });
});

describe('the same event emitted in each turn of a loop by a workflow the host runs', () => {
  it('is recorded by the playbook for each turn, under the id of that turn, and starts a workflow whose trigger takes it once for each turn', async () => {
    const settings = await onSQLite();
    const { store } = await openedOn(settings);
    const reacting = await reactingHost({ settings, clock: movedClock(Date.parse(at)), emit: emittingInto(store) });
    await definitionRecorded(store, {
      name: 'tally',
      version: 1,
      triggers: [eventTrigger({ type: 'com.acme.ticked' })],
    });
    const idOfTurn = (runHostEmissions: number) =>
      emittedEventIdOf({
        runId: `acme/${definitionOfTheTests}/${runId}`,
        reference: '/do/0/each/do/0/tick',
        run: runHostEmissions,
      });
    const eventOfTurn = (runHostEmissions: number) => ({
      type: 'com.acme.ticked',
      source: '/acme/clock',
      specversion: '1.0',
      id: idOfTurn(runHostEmissions),
      time: at,
    });

    await Effect.runPromise(reacting.host.start(runAt(runId), startOf(ticking)));
    const starts = await reacting.whenRead(
      () => Promise.resolve(reacting.reactions.starts()),
      (found) => found.length >= 2,
    );

    expect(await publishedEventIdsIn(store)).toEqual([idOfTurn(1), idOfTurn(2)]);
    expect(starts.map(({ workflow: started, input }) => [started, input])).toEqual([
      ['tally', [eventOfTurn(1)]],
      ['tally', [eventOfTurn(2)]],
    ]);
    expect(new Set(starts.map(({ runId: started }) => started)).size).toBe(2);
  });
});

describe('the emitter of the host', () => {
  it.each(emitterProbes)('$title', async (probe) => {
    const emitter = ledgerEmitter(
      eventEmitter(memoryLedger().service, playbookOwnNames),
      runsOfAlpha,
      tickingLedgerEmitter(),
    );

    expect(await Effect.runPromise(probe.run({ emitter, run }))).toEqual(probe.expected);
  });
});

describe('an event a run of the host emits', () => {
  it('is recorded as the run emitted it, one deeper, caused by the run record and in the chain of the run', async () => {
    const ledger = memoryLedger();
    const emitter = ledgerEmitter(eventEmitter(ledger.service, playbookOwnNames), runsOfAlpha, tickingLedgerEmitter());

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
            runId: runIdLedgerEmitter,
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
      runsOfAlpha,
      tickingLedgerEmitter(),
    );

    const failure = await Effect.runPromise(Effect.flip(emitter.emit(emission, run, origin)));

    expect(failure).toMatchObject({ output: 'emit_event', detail: 'The ledger cannot be reached' });
  });
});
