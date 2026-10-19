import { defineListPlaybookEvents } from '@on.auto/playbooks';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeDefinitionPresenters } from '../index.ts';
import { publishEventToAskingPlaybook as publishEvent } from '../testing/asking.ts';
import { acmeAdmin, acmeReader } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { firstMoment, harness, toPlaybook } from '../testing/harness.ts';
import { mostPublishedEventBytes } from './cloud-event.ts';
import { publishedEventDecider, publishedEventStreamOf } from './published-events.ts';

const listPlaybookEvents = defineListPlaybookEvents(makeDefinitionPresenters([echo]));

const toAlpha = toPlaybook('acme', 'alpha');

const later = '2026-10-01T09:05:00.000Z';

const monthClosed = {
  id: 'm-2026-09',
  source: '/ledger/eu',
  type: 'com.acme.ledger.month-closed',
  subject: 'september',
  time: '2026-10-01T08:59:00Z',
  data: { region: 'eu' },
  tenant: 'acme',
};

const recordedFirst = {
  status: 'succeeded',
  output: { id: 'm-2026-09', time: monthClosed.time, recorded_at: firstMoment },
};

const anUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const PublishedSchema = Schema.Struct({ output: Schema.Struct({ id: Schema.String }) });

const idOf = (outcome: unknown) => Schema.decodeUnknownSync(PublishedSchema)(outcome).output.id;

function deep(levels: number): Schema.Json {
  return levels === 0 ? 'eu' : [deep(levels - 1)];
}

function publishing(event: object) {
  return toAlpha(acmeAdmin, { event });
}

function storedOn(definitions: ReturnType<typeof harness>, source: string, id: string) {
  return Effect.runPromise(
    definitions.ledger.service.load(`playbook/acme/alpha/${publishedEventStreamOf(source, id)}`, publishedEventDecider),
  );
}

describe('publish_event', () => {
  it('is a playbook command at POST /events', () => {
    expect(publishEvent.registration).toMatchObject({
      scope: 'playbook',
      kind: 'command',
      title: 'Publish event',
      route: { method: 'POST', path: '/events' },
      successStatus: 200,
      reasons: ['invalid_input', 'conflict'],
    });
  });

  it('records the event as given, on a stream of its own, and answers its id, its time and when it was recorded', async () => {
    const definitions = harness();

    expect(await definitions.call(publishEvent, publishing(monthClosed))).toStrictEqual(recordedFirst);
    expect(await storedOn(definitions, '/ledger/eu', 'm-2026-09')).toStrictEqual({
      state: {
        type: 'event_published',
        data: { event: { specversion: '1.0', ...monthClosed }, filled: [] },
        context: { by: 'acme-admin', at: firstMoment },
      },
      version: 1,
    });
  });

  it('fills in an id and the time it records an event that has neither, so each such call is a new event', async () => {
    const definitions = harness();
    const event = { source: '/ledger/eu', type: 'com.acme.ledger.month-closed' };

    const first = await definitions.call(publishEvent, publishing(event));
    const second = await definitions.call(publishEvent, publishing(event), later);

    expect(first).toMatchObject({ status: 'succeeded', output: { time: firstMoment, recorded_at: firstMoment } });
    expect(idOf(first)).toMatch(anUuid);
    expect(idOf(second)).not.toBe(idOf(first));
    expect(await storedOn(definitions, '/ledger/eu', idOf(first))).toMatchObject({
      state: { data: { event: { specversion: '1.0', id: idOf(first), time: firstMoment }, filled: ['id', 'time'] } },
    });
  });
});

describe('publishing an event again', () => {
  it('answers the first record for the same event, even without its time, and records nothing more', async () => {
    const definitions = harness();
    const { time: _time, ...withoutTime } = monthClosed;
    await definitions.call(publishEvent, publishing(monthClosed));

    expect(await definitions.call(publishEvent, publishing(monthClosed), later)).toStrictEqual(recordedFirst);
    expect(
      await definitions.call(publishEvent, publishing({ specversion: '1.0', ...withoutTime }), later),
    ).toStrictEqual(recordedFirst);
    expect(await storedOn(definitions, '/ledger/eu', 'm-2026-09')).toMatchObject({ version: 1 });
  });

  it('answers the first record for its time spelled otherwise, and the filled time to a retry that gives one', async () => {
    const definitions = harness();
    const { time: _time, ...withoutTime } = monthClosed;
    await definitions.call(publishEvent, publishing(monthClosed));
    await definitions.call(publishEvent, publishing({ ...withoutTime, id: 'm-2026-10' }));

    expect(
      await definitions.call(publishEvent, publishing({ ...monthClosed, time: '2026-10-01t10:59:00+02:00' }), later),
    ).toStrictEqual(recordedFirst);
    expect(
      await definitions.call(publishEvent, publishing({ ...withoutTime, id: 'm-2026-10', time: later }), later),
    ).toStrictEqual({ status: 'succeeded', output: { id: 'm-2026-10', time: firstMoment, recorded_at: firstMoment } });
  });

  it('is rejected with conflict for a different event under the same source and id', async () => {
    const definitions = harness();
    await definitions.call(publishEvent, publishing(monthClosed));

    expect(await definitions.call(publishEvent, publishing({ ...monthClosed, data: { region: 'us' } }), later)).toEqual(
      {
        status: 'rejected',
        reason: 'conflict',
        detail: 'Another event was published with this source and id; give a different event an id of its own',
      },
    );
  });
});

describe('an event the playbook does not take', () => {
  it('is rejected under a type or a source that are the playbook’s own, or a type a capability of the playbook declares', async () => {
    const definitions = harness();

    expect([
      await definitions.call(publishEvent, publishing({ source: '/runs/0199a3c4', type: 'run_succeeded' })),
      await definitions.call(publishEvent, publishing({ source: '/ledger/eu', type: 'nudge_sent' })),
    ]).toMatchObject([
      {
        status: 'rejected',
        reason: 'invalid_input',
        issues: [{ pointer: '/event/type' }, { pointer: '/event/source' }],
      },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/event/type' }] },
    ]);
    expect(definitions.ledger.streamNames()).toEqual([]);
  });

  it('is rejected when it claims the cause or the correlation the playbook gives its own facts', async () => {
    const definitions = harness();

    expect(
      await definitions.call(
        publishEvent,
        publishing({
          source: '/ledger/eu',
          type: 'com.acme.approved',
          causationid: 'request-1',
          correlationid: 'run-1',
        }),
      ),
    ).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/event/causationid' }, { pointer: '/event/correlationid' }],
    });
    expect(definitions.ledger.streamNames()).toEqual([]);
  });
});

describe('an event past its bound', () => {
  it('is rejected when it takes more than its bound once its id and time are filled in', async () => {
    const definitions = harness();
    const event = { source: '/ledger/eu', type: 'com.acme.ledger.month-closed' };
    const room =
      mostPublishedEventBytes -
      JSON.stringify({ specversion: '1.0', ...event, id: 'x'.repeat(36), time: firstMoment, data: '' }).length;

    expect(await definitions.call(publishEvent, publishing({ ...event, data: 'x'.repeat(room) }))).toMatchObject({
      status: 'succeeded',
    });
    expect(await definitions.call(publishEvent, publishing({ ...event, data: 'x'.repeat(room + 1) }))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The event cannot be published as it is',
      issues: [
        {
          detail: `Expected an event of at most ${mostPublishedEventBytes} bytes as JSON in UTF-8 with its id and time, not ${mostPublishedEventBytes + 1}`,
          pointer: '/event',
        },
      ],
    });
  });
});

describe('an event whose data nests too deep', () => {
  it('is rejected when its data nests deeper than a run can hold, before anything is recorded', async () => {
    const definitions = harness();

    expect(await definitions.call(publishEvent, publishing({ ...monthClosed, data: deep(511) }))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input does not match the input schema',
      issues: [
        {
          detail: 'Expected data that nests at most 510 levels deep, so that a run can hold the event in a list',
          pointer: '/event/data',
        },
      ],
    });
    expect(definitions.ledger.streamNames()).toEqual([]);
    expect(await definitions.call(publishEvent, publishing({ ...monthClosed, data: deep(510) }))).toMatchObject({
      status: 'succeeded',
    });
  });

  it('is rejected for a caller that may only read the playbook', async () => {
    expect(await harness().call(publishEvent, toAlpha(acmeReader, { event: monthClosed }))).toMatchObject({
      status: 'rejected',
      reason: 'forbidden',
    });
  });
});

describe('the events published to a playbook', () => {
  it('appear among its events, by type and in plain words', async () => {
    const definitions = harness();
    await definitions.call(publishEvent, publishing(monthClosed));

    expect(await definitions.call(listPlaybookEvents, toAlpha(acmeReader, { type: 'event_published' }))).toMatchObject({
      status: 'succeeded',
      output: {
        events: [
          {
            type: 'event_published',
            summary: 'The event “com.acme.ledger.month-closed” was published to the playbook.',
            data: {
              event_id: 'm-2026-09',
              event_type: 'com.acme.ledger.month-closed',
              source: '/ledger/eu',
              subject: 'september',
              time: monthClosed.time,
              data: { region: 'eu' },
              filled: [],
            },
            metadata: { at: firstMoment, by: 'acme-admin' },
          },
        ],
        has_more: false,
        next_cursor: null,
      },
    });
  });
});

describe('the plain words of publish_event', () => {
  it('name the type of the event', () => {
    const { plainLanguage } = publishEvent.registration;
    const input = { event: monthClosed };

    expect([plainLanguage?.attempt(input), plainLanguage?.outcome(recordedFirst.output, input)]).toEqual([
      'publish the event “com.acme.ledger.month-closed” to the playbook',
      'The event “com.acme.ledger.month-closed” is published to the playbook. Publishing it again with the same source and id records nothing more.',
    ]);
  });
});
