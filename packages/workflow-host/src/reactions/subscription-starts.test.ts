import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { stopsInARowBeforeTheVersion } from '../filtering/filter-matching.ts';
import { followedRecordOf } from '../reaction-testing/followed-records.ts';
import { eventTrigger, type TriggerFilter } from '../reaction-testing/playbook-writes.ts';
import { starting, stopsByItsMemory, stopsByItsWork } from '../reaction-testing/trigger-starting.ts';
import { zoneClockOf } from '../schedules/zone-clock.ts';
import { triggersActivated } from '../triggers/trigger-rows.ts';
import { reactionRunIdOf } from './reaction-ids.ts';
import { mostReactionDepth } from './subscription-starts.ts';

const playbookKey = 'playbook/acme/alpha/';

const at = '2026-10-01T09:00:00.000Z';

const working = { type: 'go', data: stopsByItsWork };

const filling = { type: 'go', data: stopsByItsMemory };

type Database = Parameters<typeof triggersActivated>[0];

const european = { type: 'go', data: { region: 'eu' } };

async function subscribedAt(database: Database, version: number, name: string, ...filters: readonly TriggerFilter[]) {
  const activation = { workflow: name, version, activatedBy: `definition-${version}`, activatedAt: Date.parse(at) };
  await Effect.runPromise(
    triggersActivated(database, playbookKey, { ...activation, triggers: [eventTrigger(...filters)] }, zoneClockOf),
  );
}

function subscribed(database: Database, name: string, ...filters: readonly TriggerFilter[]) {
  return subscribedAt(database, 1, name, ...filters);
}

describe('the starts of the workflows whose trigger an event matches', () => {
  it('start each workflow whose filter takes the event, with the event as input, one deeper, under an id of the record', async () => {
    const { database, delivered, starts } = await starting();
    await subscribed(database, 'close', { type: 'go', data: { region: 'eu' } });
    await subscribed(database, 'other', { type: 'stop' }, { type: 'go', data: { region: 'us' } });

    await delivered(followedRecordOf({ region: 'eu' }));

    expect(starts()).toEqual([
      {
        org: 'acme',
        playbook: 'alpha',
        workflow: 'close',
        version: 1,
        runId: reactionRunIdOf('close', 1, '/schedule/on', 'record-1'),
        input: [{ specversion: '1.0', id: 'e1', source: '/acme', type: 'go', time: at, data: { region: 'eu' } }],
        depth: 1,
        cause: 'record-1',
        trigger: { kind: 'event', reference: '/schedule/on' },
      },
    ]);
  });

  it('say once for each version of the trigger that a filter failed on an event, which it then does not match', async () => {
    const { database, delivered, starts, said } = await starting();
    const failing = { type: 'go', data: '${ $data.a.b }' };
    await subscribed(database, 'broken', failing);

    await delivered(followedRecordOf('text'));
    await delivered(followedRecordOf('more text'));
    await subscribedAt(database, 2, 'broken', failing);
    await delivered(followedRecordOf('text again'));
    const failed =
      "broken: The filter of the workflow's event trigger failed on an event, so it did not match: An expression failed, at /schedule/on/any/0: $data.a.b: TypeError: cannot read property 'b' of undefined.";

    expect([starts(), said()]).toEqual([[], [failed, failed]]);
  });
});

describe('the filter of an event trigger that goes past a bound', () => {
  it('does not match an event on which it does more than its work, is said once a version as a failing filter is, and is evaluated on the next event', async () => {
    const { database, delivered, starts, said, evaluated } = await starting();
    await subscribed(database, 'busy', working, european);

    await delivered(followedRecordOf({ region: 'us' }));
    await delivered(followedRecordOf({ region: 'eu' }));

    expect(evaluated()).toEqual([
      '/schedule/on/any/0',
      '/schedule/on/any/1',
      '/schedule/on/any/0',
      '/schedule/on/any/1',
    ]);
    expect(said()).toEqual([
      expect.stringMatching(
        /^busy: The filter of the workflow's event trigger failed on an event, so it did not match: .*The program did more work than it may/u,
      ),
    ]);
    expect(starts().map(({ workflow }) => workflow)).toEqual(['busy']);
  });

  it(`keeps the event it was stopped on by its memory waiting, is stopped for its version at the ${stopsInARowBeforeTheVersion}rd such stop in a row, and is evaluated again after a new version`, async () => {
    const { database, tried, starts, said, evaluated } = await starting();
    await subscribed(database, 'filling', filling, european);
    const american = followedRecordOf({ region: 'us' });

    const tries = [await tried(american), await tried(american), await tried(american)];
    const matched = await tried(followedRecordOf({ region: 'eu' }));
    const beforeTheVersion = evaluated().length;
    await subscribedAt(database, 2, 'filling', filling, european);
    const afterTheVersion = await tried(american);

    expect([tries, matched]).toEqual([[['filling waits'], ['filling waits'], []], ['filling delivered']]);
    expect(said()).toEqual([
      expect.stringContaining(
        "filling: The filter of the workflow's event trigger was stopped by its deadline or its memory 3 times in a row, so it is not evaluated again for this version of the workflow; a new version evaluates it again: ",
      ),
    ]);
    expect([beforeTheVersion, evaluated().slice(beforeTheVersion - 1)]).toEqual([
      7,
      ['/schedule/on/any/1', '/schedule/on/any/0', '/schedule/on/any/1'],
    ]);
    expect([starts().map(({ version }) => version), afterTheVersion]).toEqual([[1], ['filling waits']]);
  });
});

describe('a filter that names a count of the context', () => {
  it('matches the first run a reaction started by depth 1, and no run of another depth', async () => {
    const { database, delivered, starts } = await starting();
    await subscribed(database, 'first', { type: 'run_succeeded', depth: 1 });
    await subscribed(database, 'second', { type: 'run_succeeded', depth: 2 });
    const firstRun = {
      specversion: '1.0' as const,
      id: 'record-1',
      source: '/runs/r-1',
      type: 'run_succeeded',
      subject: 'workflow/close',
      time: at,
      depth: 1,
      caller: 'playbook:alpha',
      definitionversion: 1,
    };

    await delivered(followedRecordOf(null, { event: firstRun, depth: 2 }));

    expect(starts().map(({ workflow }) => workflow)).toEqual(['first']);
  });
});

describe('an event a filter was stopped on, kept waiting', () => {
  it('is said as a start skipped, with the version of the workflow, when it waited too long', async () => {
    const { database, consumer, said } = await starting();
    await subscribed(database, 'filling', filling);

    const { deliveries } = await Effect.runPromise(consumer.batchOf(followedRecordOf({ region: 'us' }), undefined, 10));
    await Effect.runPromise(Effect.forEach(deliveries, ({ skipped }) => skipped('it waited too long')));

    expect(said()).toEqual(['filling: The workflow could not be started by its event trigger: it waited too long']);
  });
});

describe('the event triggers an event is matched against', () => {
  it('are those that name its type, so the filters of other types are never evaluated on it', async () => {
    const { database, delivered, starts, said } = await starting();
    await subscribed(database, 'other', { data: '${ $data.a.b }', type: 'stop' });
    await subscribed(database, 'close', { type: 'go' });

    await delivered(followedRecordOf('text'));

    expect([starts().map(({ workflow }) => workflow), said()]).toEqual([['close'], []]);
  });

  it('start a workflow once for an event that two filters of its trigger match', async () => {
    const { database, delivered, starts } = await starting();
    await subscribed(database, 'close', { type: 'go', data: { region: 'eu' } }, { type: 'go' });

    await delivered(followedRecordOf({ region: 'eu' }));

    expect(starts().map(({ workflow }) => workflow)).toEqual(['close']);
  });
});

describe('the starts a workflow is kept from', () => {
  it('are those for records about its own runs, about runs one of its runs began, or past the reaction depth', async () => {
    const { database, delivered, starts, said } = await starting();
    await subscribed(database, 'close', { type: 'go' });

    await delivered(followedRecordOf(null, { ownedBy: ['close'] }));
    await delivered(followedRecordOf(null, { topRun: 'r-of-close' }));
    await delivered(followedRecordOf(null, { topRun: 'r-of-other', depth: mostReactionDepth }));
    await delivered(followedRecordOf(null, { depth: mostReactionDepth + 1 }));

    expect(starts().map(({ depth }) => depth)).toEqual([mostReactionDepth]);
    expect(said()).toEqual([
      'close: An event matched the event trigger of the workflow at reaction depth 9, past the 8 a chain of reactions may reach',
    ]);
  });
});

describe('the subscriptions an event is matched against', () => {
  it('are taken in batches, each from where the last one ended, and a start skipped is said', async () => {
    const { database, consumer, said } = await starting();
    await subscribed(database, 'a', { type: 'go' });
    await subscribed(database, 'b', { type: 'go' });
    await subscribed(database, 'c', { type: 'go' });
    const followed = followedRecordOf(null);

    const first = await Effect.runPromise(consumer.batchOf(followed, undefined, 2));
    const second = await Effect.runPromise(consumer.batchOf(followed, first.through, 2));
    await Effect.runPromise(Effect.forEach(second.deliveries, ({ skipped }) => skipped('refused')));

    expect([first.deliveries.length, first.through, first.more, second.deliveries.length, second.more]).toEqual([
      2,
      'b',
      true,
      1,
      false,
    ]);
    expect(said()).toEqual(['c: The workflow could not be started by its event trigger: refused']);
  });
});
