import type { Json } from '@on.auto/workflow-engine';
import { describe, expect, it } from 'vitest';

import { mostTriggerFilters, scheduleRejections, triggersOfDocument } from './workflow-schedule.ts';

function refused(schedule: Json): readonly string[] {
  return scheduleRejections(schedule, '/schedule').map(({ pointer, detail }) => `${pointer}: ${detail}`);
}

const typed = { with: { type: 'com.acme.closed' } };

function typedFilters(count: number): readonly Json[] {
  return Array.from({ length: count }, (_, index) => ({ with: { type: `com.acme.t${index}` } }));
}

describe('the schedule of a workflow, which names its triggers', () => {
  it('is a mapping of on, cron and every, any one, two or three of them', () => {
    expect([
      refused('daily'),
      refused({}),
      refused({ every: 'PT1M', cron: '0 9 * * *' }),
      refused({ on: { one: typed }, cron: '0 9 * * *', every: 'PT15M' }),
      refused({ every: 'PT1M', at: 'noon' }),
      refused({ after: 'PT1M' }),
      refused({ after: 'PT1M', every: 'PT1M' }),
    ]).toEqual([
      ['/schedule: schedule is a mapping that names the triggers of the workflow: on, cron and every'],
      ['/schedule: A schedule names at least one trigger: on, cron or every, each at most once'],
      [],
      [],
      ['/schedule/at: schedule takes on, cron, every and time_zone, not at'],
      [
        '/schedule/after: A workflow is not started again after its run ends: give it a trigger with on, cron or every instead',
      ],
      [
        '/schedule/after: A workflow is not started again after its run ends: give it a trigger with on, cron or every instead',
      ],
    ]);
  });

  it('checks each of its triggers on its own', () => {
    expect(refused({ on: { any: [] }, cron: 5, every: 'PT30S' })).toEqual([
      '/schedule/on: on takes one, a filter of the events that start the workflow, or any, a list of at least one',
      '/schedule/cron: cron is text of five fields, minute, hour, day of month, month and day of week',
      '/schedule/every: A schedule is due at most once a minute, not every 30000 ms',
    ]);
  });
});

describe('the schedule triggers of a workflow', () => {
  it('every is a duration of a minute or more', () => {
    expect([
      refused({ every: 'PT1M' }),
      refused({ every: { hours: 2 } }),
      refused({ every: 'PT30S' }),
      refused({ every: 'soon' }),
    ]).toEqual([
      [],
      [],
      ['/schedule/every: A schedule is due at most once a minute, not every 30000 ms'],
      ['/schedule/every: soon is not an ISO 8601 duration'],
    ]);
  });

  it('cron is text of five fields that name a time that comes', () => {
    expect([refused({ cron: '30 2 * * 1-5' }), refused({ cron: 5 }), refused({ cron: '61 2 * * *' })]).toEqual([
      [],
      ['/schedule/cron: cron is text of five fields, minute, hour, day of month, month and day of week'],
      ['/schedule/cron: The cron expression 61 2 * * * cannot be read: CronPattern: Invalid value for minute: 61'],
    ]);
  });

  it('cron is read in the IANA time zone time_zone names, which goes with cron alone', () => {
    expect([
      refused({ cron: '0 6 * * *', time_zone: 'America/New_York' }),
      refused({ cron: '0 6 * * *', every: 'PT1H', time_zone: 'Europe/London' }),
      refused({ cron: '0 6 * * *', time_zone: 'Mars/Olympus' }),
      refused({ cron: '0 6 * * *', time_zone: '+05:00' }),
      refused({ cron: '0 6 * * *', time_zone: 5 }),
      refused({ every: 'PT1H', time_zone: 'Europe/London' }),
    ]).toEqual([
      [],
      [],
      ['/schedule/time_zone: time_zone expects an IANA time zone name such as Europe/London, not "Mars/Olympus"'],
      ['/schedule/time_zone: time_zone expects an IANA time zone name such as Europe/London, not "+05:00"'],
      ['/schedule/time_zone: time_zone expects an IANA time zone name such as Europe/London, not 5'],
      [
        '/schedule/time_zone: time_zone is the time zone of cron, so a schedule without cron takes none; every counts a period, which has no time zone',
      ],
    ]);
  });
});

describe('the events that start a workflow', () => {
  it('are one filter or any of a list of filters, each naming the type of its events', () => {
    expect([
      refused({ on: { one: typed } }),
      refused({ on: { any: [typed, { with: { type: 'com.acme.opened', data: { region: 'eu' } } }] } }),
      refused({ on: { any: [typed, { with: { source: '/ledger' } }] } }),
    ]).toEqual([
      [],
      [],
      [
        '/schedule/on/any/1/with/type: An event filter matched over the event alone names the type of the events it takes',
      ],
    ]);
  });

  it('are neither all of a list, nor none, nor until something', () => {
    expect([
      refused({ on: 'events' }),
      refused({ on: {} }),
      refused({ on: { any: [] } }),
      refused({ on: { all: [typed] } }),
      refused({ on: { one: typed, until: { one: typed } } }),
    ]).toEqual([
      ['/schedule/on: on takes one, a filter of the events that start the workflow, or any, a list of at least one'],
      ['/schedule/on: on takes one, a filter of the events that start the workflow, or any, a list of at least one'],
      ['/schedule/on: on takes one, a filter of the events that start the workflow, or any, a list of at least one'],
      [
        '/schedule/on/all: A trigger starts a run for every event that matches it, so it takes one or any; all, which waits for several events, is for a listen task',
      ],
      [
        '/schedule/on/until: A trigger matches every event of its playbook while its version is active, so it takes no until',
      ],
    ]);
  });
});

describe('the filters of an event trigger', () => {
  it('are each written once: a filter whose type and attributes another has, in any order, is refused', () => {
    const eu = { with: { type: 'com.acme.closed', data: { region: 'eu', team: 'ledger' } } };
    const euAgain = { with: { data: { team: 'ledger', region: 'eu' }, type: 'com.acme.closed' } };
    const us = { with: { type: 'com.acme.closed', data: { region: 'us', team: 'ledger' } } };

    expect([refused({ on: { any: [eu, us, euAgain, typed, typed] } }), refused({ on: { any: [eu, us] } })]).toEqual([
      [
        '/schedule/on/any/2: This filter takes the same events as the one at /schedule/on/any/0',
        '/schedule/on/any/4: This filter takes the same events as the one at /schedule/on/any/3',
      ],
      [],
    ]);
  });

  it(`are ${mostTriggerFilters} at most`, () => {
    expect([
      refused({ on: { any: typedFilters(mostTriggerFilters) } }),
      refused({ on: { any: typedFilters(mostTriggerFilters + 1) } }),
    ]).toEqual([
      [],
      [
        '/schedule/on/any: A trigger takes at most 64 filters, since each is matched against every event of a type it names for as long as its version is active',
      ],
    ]);
  });
});

describe('the triggers of a saved workflow', () => {
  it('are read from its schedule in the order it names them, each with its place in the document', () => {
    expect(
      triggersOfDocument({
        schedule: { cron: '0 9 * * *', on: { any: [typed, { with: {} }] }, every: 'PT5M' },
      }),
    ).toEqual([
      { kind: 'cron', reference: '/schedule/cron', expression: '0 9 * * *' },
      {
        kind: 'event',
        reference: '/schedule/on',
        filters: [
          { reference: '/schedule/on/any/0', type: 'com.acme.closed', attributes: { type: 'com.acme.closed' } },
        ],
      },
      { kind: 'every', reference: '/schedule/every', milliseconds: 300_000 },
    ]);
  });

  it('give cron the time zone its schedule names, and every none', () => {
    expect(
      triggersOfDocument({ schedule: { every: 'PT5M', cron: '0 6 * * *', time_zone: 'America/New_York' } }),
    ).toEqual([
      { kind: 'every', reference: '/schedule/every', milliseconds: 300_000 },
      { kind: 'cron', reference: '/schedule/cron', expression: '0 6 * * *', time_zone: 'America/New_York' },
    ]);
  });

  it('are none for a workflow without a schedule, or for what a schedule names that is not a trigger', () => {
    expect([
      triggersOfDocument({ do: [] }),
      triggersOfDocument({ schedule: 'daily' }),
      triggersOfDocument({ schedule: { after: 'PT1M', on: 'events', cron: 5, every: 'soon' } }),
      triggersOfDocument({ schedule: { on: { one: typed } } }),
    ]).toEqual([
      [],
      [],
      [],
      [
        {
          kind: 'event',
          reference: '/schedule/on',
          filters: [
            { reference: '/schedule/on/one', type: 'com.acme.closed', attributes: { type: 'com.acme.closed' } },
          ],
        },
      ],
    ]);
  });
});
