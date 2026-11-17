import { erasingReader, keptIn } from '@on.auto/definitions/testing';
import { type Context, type RecordedEvent, Unavailable } from '@on.auto/operations';
import { type PayloadReader, payloadReaderOf } from '@on.auto/operations/payloads';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { waitingCallsOf } from '../calls/call-rows.ts';
import type { HostDatabase } from '../database/host-database.ts';
import {
  alpha,
  at,
  definitionRecordAt,
  definitionRecorded,
  eventTrigger,
  playbookCreated,
  published,
  recorded,
} from '../reaction-testing/playbook-writes.ts';
import { recordedReactions } from '../reaction-testing/recorded-reactions.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { until } from '../testing/until.ts';
import { followedThroughTheLatest } from '../waiting-testing/followed-host.ts';
import { heldFollower } from '../waiting-testing/held-follower.ts';
import { parentId, parentRun } from '../waiting-testing/waiting-parent.ts';
import { type FollowedEvent, followedEventOf, followedEventRead } from './followed-events.ts';

const atFollowedEvents = '2026-10-01T09:00:00.000Z';

const told = { specversion: '1.0', id: 'e1', source: '/acme', type: 'com.acme.told', time: atFollowedEvents };

const byAdmin: Context = { by: 'acme-admin', at: atFollowedEvents };

interface Fact {
  readonly type: string;
  readonly data?: Schema.Json;
}

function recordOf(stream: string, { type, data = {} }: Fact, context = byAdmin, correlationId: string | null = null) {
  const record: RecordedEvent = {
    id: `id-${stream}`,
    cursor: 'c',
    causationId: null,
    correlationId,
    stream,
    version: 1,
    globalPosition: 1,
    type,
    data,
    context,
    recordedAt: atFollowedEvents,
  };
  return record;
}

function publishedFollowedEvents(context: Context = byAdmin, correlationId: string | null = null) {
  const record = recordOf(
    'events/e1',
    { type: 'event_published', data: { event: told, filled: [] } },
    context,
    correlationId,
  );
  return followedEventOf(record, 'workflow');
}

function runFact(runId: string, [type, name]: readonly [string, string], correlationId: string | null) {
  const context = { ...byAdmin, runId, definitionType: type, definitionName: name, definitionVersion: 1 };
  return followedEventOf(
    recordOf(
      `runs/${runId}`,
      { type: 'run_started', data: { started_by: { id: 'acme-admin', name: 'acme-admin' }, input: {} } },
      context,
      correlationId,
    ),
    'workflow',
  );
}

const emittedBy: Context = {
  ...byAdmin,
  runId: 'r-nested',
  definitionType: 'workflow',
  definitionName: 'close',
  definitionVersion: 1,
  depth: 2,
};

const atFollowedOutputs = '2026-10-01T09:00:00.000Z';

const alphaFollowedOutputs = { org: 'acme', playbook: 'alpha' };

const ofTheReport: Context = {
  at: atFollowedOutputs,
  by: 'acme-admin',
  runId: 'r-1',
  definitionType: 'workflow',
  definitionName: 'report',
  definitionVersion: 1,
};

const output = { report: 'r'.repeat(40_000) };

function recordOfFollowedOutputs(stream: string, type: string, data: Schema.Json, context: Context): RecordedEvent {
  return {
    id: `id-${stream}`,
    cursor: 'c',
    causationId: null,
    correlationId: null,
    stream,
    version: 2,
    globalPosition: 2,
    type,
    data,
    context,
    recordedAt: atFollowedOutputs,
  };
}

function followedOf(record: RecordedEvent): FollowedEvent {
  const followed = followedEventOf(record, 'workflow');
  if (typeof followed === 'string') {
    throw new TypeError(`The record ${record.id} makes no event`);
  }
  return followed;
}

async function keptSuccess() {
  const { content } = memoryLedger().service;
  const { sha256, bytes } = await Effect.runPromise(keptIn(content, alphaFollowedOutputs, output));
  const record = recordOfFollowedOutputs(
    'runs/r-1',
    'run_succeeded',
    { output_sha256: sha256, output_bytes: bytes, record: {} },
    ofTheReport,
  );
  return { record, followed: followedOf(record), reader: payloadReaderOf({ owner: alphaFollowedOutputs, content }) };
}

function unanswering(reader: PayloadReader): PayloadReader {
  return { ...reader, json: () => Effect.fail(new Unavailable({ detail: 'The content store did not answer' })) };
}

const child = '0199a3c4-7d2e-7c1a-9b3f-0000000000c1';

const asking = workflow('do:\n  - ask: { call: notify, with: { to: ada } }');

const pausing = workflow('do:\n  - pause: { wait: PT1H }');

const ofTheChild = {
  by: 'playbook:alpha',
  at,
  runId: child,
  definitionType: 'workflow',
  definitionName: 'check',
  definitionVersion: 1,
  calledBy: { runId: parentId, reference: '/do/0/ask', run: 1 },
};

const ofTheRun = {
  by: 'acme-admin',
  at,
  runId: parentId,
  definitionType: 'workflow',
  definitionName: 'pause',
  definitionVersion: 1,
};

const aPlaybookWithoutIt = 'playbook/acme/elsewhere/';

function withoutThePlaceOf(database: HostDatabase, id: string): HostDatabase {
  return {
    ...database,
    store: {
      ...database.store,
      readRecordedEvent: (playbookKey, asked) =>
        database.store.readRecordedEvent(asked === id ? aPlaybookWithoutIt : playbookKey, asked),
    },
  };
}

describe('an event published to a playbook, as the follower reads it', () => {
  it('is the event at depth 1 when sent from outside, owned by no workflow', () => {
    expect(publishedFollowedEvents()).toEqual({
      event: told,
      depth: 1,
      emitter: undefined,
      ownedBy: [],
      topRun: undefined,
    });
  });

  it('when a run emitted it, is owned by the workflow of that run, and names the run that began the chain', () => {
    expect([
      publishedFollowedEvents(emittedBy, 'r-top'),
      publishedFollowedEvents(emittedBy, 'r-nested'),
      publishedFollowedEvents(emittedBy),
    ]).toMatchObject([
      { depth: 2, emitter: { runId: 'r-nested', workflow: 'close' }, ownedBy: ['close'], topRun: 'r-top' },
      { topRun: undefined },
      { topRun: undefined },
    ]);
  });

  it('is unreadable when its record cannot be read as a publication', () => {
    expect(followedEventOf(recordOf('events/e1', { type: 'event_published' }), 'workflow')).toBe('unreadable');
  });

  it('is unreadable, and starts no chain at depth 1, when its context names a run but not as an emitted event does', () => {
    const { depth: _depth, ...withoutDepth } = emittedBy;

    expect([
      publishedFollowedEvents(withoutDepth),
      publishedFollowedEvents({ ...byAdmin, runId: 'r-nested', definitionType: 'reasoning', definitionName: 'sum' }),
    ]).toEqual(['unreadable', 'unreadable']);
  });
});

describe('a fact of a playbook, as the follower reads it', () => {
  it('about a run, is owned by the workflow it ran and names the run that began the chain, one deeper', () => {
    expect([runFact('r-1', ['workflow', 'close'], 'r-top'), runFact('r-2', ['reasoning', 'sum'], 'r-2')]).toMatchObject(
      [
        {
          depth: 1,
          ownedBy: ['close'],
          topRun: 'r-top',
          event: { type: 'run_started', subject: 'workflow/close' },
        },
        { depth: 1, ownedBy: [], topRun: undefined, event: { subject: 'reasoning/sum' } },
      ],
    );
  });

  it('about a definition, is owned by no workflow', () => {
    const retired = recordOf(
      'definitions/workflow',
      { type: 'definition_retired' },
      { ...byAdmin, definitionType: 'workflow', definitionName: 'close', definitionVersion: 2 },
    );

    expect(followedEventOf(retired, 'workflow')).toMatchObject({
      depth: 1,
      ownedBy: [],
      topRun: undefined,
      event: { type: 'definition_retired', source: '/definitions/workflow/close' },
    });
  });
});

describe('a fact of a playbook that is none, or cannot be read, as the follower reads it', () => {
  it('is unreadable when its record cannot be read, and no fact at all for a record that is none', () => {
    expect([
      followedEventOf(
        recordOf('runs/r-1', {
          type: 'run_started',
          data: { input: 7, calls_tools: false },
        }),
        'workflow',
      ),
      followedEventOf(recordOf('runs/r-1', { type: 'call_recorded' }), 'workflow'),
      followedEventOf(recordOf('run-logs/r-1', { type: 'input_applied' }), 'workflow'),
    ]).toEqual(['unreadable', 'none', 'none']);
  });

  it('is none for the records of a call made by hand, which no view folds and no trigger takes, with no note', () => {
    const called = { call_id: 'c-1', server: 'graph', tool: 'search', arguments_bytes: 2 };

    expect([
      followedEventOf(recordOf('tool-calls/c-1', { type: 'tool_call_started', data: called }), 'workflow'),
      followedEventOf(recordOf('tool-calls/c-1', { type: 'tool_call_answered', data: called }), 'workflow'),
      followedEventOf(recordOf('tool-calls/c-1', { type: 'tool_call_started' }), 'page'),
    ]).toEqual(['none', 'none', 'none']);
  });
});

describe('the reads and tellings of a conversation, as the follower meets them', () => {
  it('are none, which no view folds and no trigger takes', () => {
    const read = { call_id: 'c-1', server: 'chat', tool: 'thread_replies' };

    expect([
      followedEventOf(recordOf('conversation-calls/c-1', { type: 'replies_read', data: read }), 'workflow'),
      followedEventOf(recordOf('conversation-calls/c-1', { type: 'telling_started', data: read }), 'page'),
    ]).toEqual(['none', 'none']);
  });
});

describe('the event of a run’s success whose output its playbook keeps outside, read for its consumers', () => {
  it('carries the output read from the playbook’s content', async () => {
    const { record, followed, reader } = await keptSuccess();

    const read = await Effect.runPromise(followedEventRead(record, followed, reader));

    expect(followed.event.data).toEqual({ output_bytes: JSON.stringify(output).length });
    expect(read).toEqual({ event: { ...followed, event: { ...followed.event, data: { output } } } });
  });

  it('is held while the content store does not answer, missing where it holds the output no more, and its size where erased', async () => {
    const { record, followed, reader } = await keptSuccess();
    const reads = [
      followedEventRead(record, followed, unanswering(reader)),
      followedEventRead(
        record,
        followed,
        payloadReaderOf({ owner: alphaFollowedOutputs, content: memoryLedger().service.content }),
      ),
      followedEventRead(record, followed, erasingReader(alphaFollowedOutputs)),
    ];

    expect(await Effect.runPromise(Effect.all(reads))).toEqual(['held', 'missing', { event: followed }]);
  });

  it('is as it was made, reading nothing, for a published event', async () => {
    const toldFollowedOutputs = {
      specversion: '1.0',
      id: 'e1',
      source: '/acme',
      type: 'com.acme.told',
      time: atFollowedOutputs,
    };
    const record = recordOfFollowedOutputs(
      'events/e1',
      'event_published',
      { event: toldFollowedOutputs, filled: [] },
      { at: atFollowedOutputs, by: 'acme-admin' },
    );
    const followed = followedOf(record);

    expect(await Effect.runPromise(followedEventRead(record, followed, erasingReader(alphaFollowedOutputs)))).toEqual({
      event: followed,
    });
  });
});

describe('the ending of a run a call waits for, appended after the host opened and before its follower first passed the playbook', () => {
  it('answers the call as the follower first passes the playbook from where the host opened, not at its deadline', async () => {
    const { database, hosted, settled, release } = await heldFollower({
      answer: () => Effect.succeed({ status: 'waiting', child }),
    });
    hosted.know(parentId);
    await Effect.runPromise(hosted.host.start(runAt(parentId), startOf(asking)));
    await until(
      () => Effect.runPromise(waitingCallsOf(database, parentRun)),
      (waiting) => waiting.length === 1,
    );
    await recorded(
      database.store,
      `${alpha}runs/${child}`,
      { type: 'run_succeeded', data: { output: 'checked', record: {} } },
      ofTheChild,
    );

    release();

    expect(await settled(parentId)).toEqual({ status: 'succeeded', output: 'checked' });
  });
});

describe('a cancel request appended after the host opened and before its follower first passed the playbook', () => {
  it('ends its run cancelled as the follower first passes the playbook from where the host opened', async () => {
    const { database, hosted, settled, release } = await heldFollower();
    hosted.know(parentId);
    await Effect.runPromise(hosted.host.start(runAt(parentId), startOf(pausing)));
    await recorded(
      database.store,
      `${alpha}runs/${parentId}`,
      { type: 'run_cancel_requested', data: { kind: 'requested', reason: 'Not needed any more' } },
      ofTheRun,
    );

    release();

    expect(await settled(parentId)).toEqual({
      status: 'rejected',
      reason: 'cancelled',
      kind: 'requested',
      detail: 'Not needed any more',
      by: 'acme-admin',
    });
  });
});

describe('a definition record whose place the first follow of its playbook cannot find', () => {
  it('is noted as unreadable and applied neither as before the open nor after it, so its trigger starts no run', async () => {
    const database = await openedOn(await onSQLite());
    await playbookCreated(database.store, 'alpha');
    await definitionRecorded(database.store, {
      name: 'close',
      version: 1,
      triggers: [eventTrigger({ type: 'com.acme.closed' })],
    });
    const reactions = recordedReactions();
    const hosted = await hostedOn(
      { database: withoutThePlaceOf(database, definitionRecordAt(1)) },
      {
        reactions: reactions.options,
      },
    );

    await published(database.store, { id: 'e1', type: 'com.acme.closed' });
    const notes = await until(
      () => Promise.resolve(hosted.notes()),
      (noted) => noted.length > 0,
    );
    await followedThroughTheLatest(database);

    expect([notes, reactions.starts()]).toEqual([
      [
        {
          kind: 'record_unreadable',
          org: 'acme',
          playbook: 'alpha',
          recordId: definitionRecordAt(1),
          type: 'definition_created',
        },
      ],
      [],
    ]);
  });
});
