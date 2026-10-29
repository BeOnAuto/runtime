import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { Conflict, recordingOf, type Context } from '@on.auto/operations';
import { Effect, Exit, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { CloudEvent } from './cloud-event.ts';
import {
  EventPublishedSchema,
  publishedEventDecider,
  publishedEventOf,
  publishedEventStreamOf,
  recordedPublication,
  type EventPublished,
  type PublishEvent,
  type RecordedEventPublished,
} from './published-events.ts';

const nameBasedUuid = /^events\/[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const monthClosed: CloudEvent = {
  specversion: '1.0',
  id: 'm-2026-09',
  source: '/ledger/eu',
  type: 'com.acme.ledger.month-closed',
  subject: 'september',
  time: '2026-10-01T08:59:00Z',
  data: { region: 'eu', totals: { revenue: 120, costs: 80 } },
  tenant: 'acme',
};

const first: PublishEvent = { event: monthClosed, filled: [], by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const fact: EventPublished = { type: 'event_published', data: { event: monthClosed, filled: [] } };

const published: RecordedEventPublished = { ...fact, context: { at: first.at, by: first.by } };

const again = { by: 'acme-admin', at: '2026-10-01T09:05:00.000Z' };

function decidedAfter(publish: PublishEvent, recorded: RecordedEventPublished = published) {
  return publishedEventDecider.decide(publish, publishedEventDecider.evolve(undefined, recorded));
}

const anotherEvent = Result.fail(
  new Conflict({
    detail: 'Another event was published with this source and id; give a different event an id of its own',
  }),
);

function spelled(time: string) {
  return decidedAfter({ ...first, event: { ...monthClosed, time }, ...again });
}

describe('the stream of a published event', () => {
  it('is named by a name-based UUID of its source and id, the same for the same pair', () => {
    const stream = publishedEventStreamOf('/ledger/eu', 'm-2026-09');

    expect(stream).toMatch(nameBasedUuid);
    expect(publishedEventStreamOf('/ledger/eu', 'm-2026-09')).toBe(stream);
  });

  it('differs for another source or another id, however the two are split', () => {
    const streams = new Set([
      publishedEventStreamOf('/ledger/eu', 'm-2026-09'),
      publishedEventStreamOf('/ledger/us', 'm-2026-09'),
      publishedEventStreamOf('/ledger/eu', 'm-2026-10'),
      publishedEventStreamOf('/ledger/e', 'um-2026-09'),
    ]);

    expect(streams.size).toBe(4);
  });
});

describe('publishing an event', () => {
  it('records it on a stream nobody wrote, with who published it and when as its context', () => {
    expect(publishedEventDecider.decide(first, publishedEventDecider.initialState)).toStrictEqual(
      Result.succeed([fact]),
    );
    expect(publishedEventDecider.context(first, publishedEventDecider.initialState)).toStrictEqual(published.context);
  });

  it('takes the run and the workflow that emitted it, and its depth, as its context', () => {
    const emitted = { ...first, emittedBy: { run_id: 'r-1', workflow: 'close', version: 4 }, depth: 2 };

    expect(publishedEventDecider.context(emitted, publishedEventDecider.initialState)).toStrictEqual({
      ...published.context,
      runId: 'r-1',
      definitionType: 'workflow',
      definitionName: 'close',
      definitionVersion: 4,
      depth: 2,
    });
  });
});

describe('publishing the same event again', () => {
  it('records nothing for the same event again, in any order of its keys', () => {
    const reordered = Object.fromEntries(Object.entries(monthClosed).toReversed());

    expect(decidedAfter({ ...first, ...again })).toStrictEqual(Result.succeed([]));
    expect(decidedAfter({ ...first, event: { ...monthClosed, ...reordered }, ...again })).toStrictEqual(
      Result.succeed([]),
    );
  });

  it('compares only what both callers gave, so a time the playbook filled in on either side is left out', () => {
    const later = { ...monthClosed, time: '2026-10-01T09:05:00.000Z' };
    const timeFilledFirst: RecordedEventPublished = { ...published, data: { ...published.data, filled: ['time'] } };

    expect(decidedAfter({ event: later, filled: ['time'], ...again })).toStrictEqual(Result.succeed([]));
    expect(decidedAfter({ event: later, filled: [], ...again }, timeFilledFirst)).toStrictEqual(Result.succeed([]));
    expect(decidedAfter({ event: later, filled: [], ...again })).toStrictEqual(anotherEvent);
  });

  it('compares times as instants, so the same instant spelled otherwise is the same event', () => {
    expect(
      ['2026-10-01t08:59:00z', '2026-10-01T08:59:00.000Z', '2026-10-01T10:59:00+02:00'].map((time) => spelled(time)),
    ).toStrictEqual([Result.succeed([]), Result.succeed([]), Result.succeed([])]);
    expect(spelled('2026-10-01T08:59:00.001Z')).toStrictEqual(anotherEvent);
  });

  it('is refused for a different event under the same source and id', () => {
    const { subject: _subject, ...withoutSubject } = monthClosed;

    expect(decidedAfter({ ...first, event: { ...monthClosed, data: { region: 'us' } }, ...again })).toStrictEqual(
      anotherEvent,
    );
    expect(decidedAfter({ ...first, event: withoutSubject, ...again })).toStrictEqual(anotherEvent);
    expect(decidedAfter({ ...first, event: { ...monthClosed, tenant: 'globex' }, ...again })).toStrictEqual(
      anotherEvent,
    );
  });
});

describe('the publication a stream holds', () => {
  it('is the event it recorded, and a defect when it holds none', async () => {
    expect(await Effect.runPromise(recordedPublication(published))).toBe(published);
    expect(Exit.isFailure(await Effect.runPromiseExit(recordedPublication(publishedEventDecider.initialState)))).toBe(
      true,
    );
  });
});

const emittedContext = {
  ...published.context,
  runId: 'r-1',
  definitionType: 'workflow',
  definitionName: 'close',
  definitionVersion: 4,
  depth: 2,
};

const { depth: _depth, ...withoutDepth } = emittedContext;

const { definitionName: _name, ...withoutName } = emittedContext;

const namingARunButNotEmitted: readonly Context[] = [
  withoutDepth,
  withoutName,
  { ...emittedContext, definitionVersion: 0 },
];

describe('a published event read back', () => {
  it('is emitted by a workflow when its context names a run, and published by a caller when it names none', () => {
    expect([
      publishedEventOf({ ...fact, context: emittedContext }),
      publishedEventOf({ ...fact, context: published.context }),
    ]).toStrictEqual([
      { ...fact, context: emittedContext },
      { ...fact, context: published.context },
    ]);
  });

  it('does not decode when its context names a run without the depth, the name or a version from 1 an emitted event carries', () => {
    expect(namingARunButNotEmitted.map((context) => publishedEventOf({ ...fact, context }))).toStrictEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('is refused at append when its context names a run but is not the context of an emitted event', () => {
    const recorded = recordingOf(EventPublishedSchema);

    for (const context of namingARunButNotEmitted) {
      expect(() => recorded(fact, context)).toThrow('runId');
    }
    expect(recorded(fact, emittedContext)).toStrictEqual({ ...fact, context: emittedContext });
  });
});

describe('the facts of the events a playbook published', () => {
  recordedFactsBehaviour({
    schema: EventPublishedSchema,
    folder: new URL('.', import.meta.url),
    releases: {
      '0.46.0': [
        {
          type: 'event_published',
          data: { event: monthClosed, filled: ['time'] },
          context: {
            at: '2026-10-01T09:00:00.000Z',
            by: 'playbook:alpha',
            runId: '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
            definitionType: 'workflow',
            definitionName: 'close-the-month',
            definitionVersion: 3,
            depth: 1,
          },
        },
      ],
    },
  });
});
