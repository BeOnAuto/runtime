import { emittedEventIdOf } from '@on.auto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { emittingInto, publishedEventIdsIn } from '../reaction-testing/ledger-emissions.ts';
import { movedClock } from '../reaction-testing/moved-clock.ts';
import { at, definitionRecorded, eventTrigger } from '../reaction-testing/playbook-writes.ts';
import { reactingHost } from '../reaction-testing/reacting-host.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { until } from '../testing/until.ts';

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

describe('a workflow run by the host that emits an event', () => {
  it('hands the event to the playbook as emitted by the run and its workflow, one deeper than the run', async () => {
    const reacting = await reactingHost();
    const start = startOf(announcing);
    const attributes = { ...start.attributes, definition: { name: 'close', version: 3 }, caller: { id: 'acme-admin' } };

    await Effect.runPromise(reacting.host.start(runAt(runId), { ...start, attributes }));
    const emissions = await until(
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
    const idOfTurn = (run: number) =>
      emittedEventIdOf({ runId: `acme/alpha/${runId}`, reference: '/do/0/each/do/0/tick', run });
    const eventOfTurn = (run: number) => ({
      type: 'com.acme.ticked',
      source: '/acme/clock',
      specversion: '1.0',
      id: idOfTurn(run),
      time: at,
    });

    await Effect.runPromise(reacting.host.start(runAt(runId), startOf(ticking)));
    const starts = await until(
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
