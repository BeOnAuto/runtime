import type { Context, RecordedEvent } from '@on.auto/operations';
import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { followedEventOf } from './followed-events.ts';

const at = '2026-10-01T09:00:00.000Z';

const told = { specversion: '1.0', id: 'e1', source: '/acme', type: 'com.acme.told', time: at };

const byAdmin: Context = { by: 'acme-admin', at };

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
    recordedAt: at,
  };
  return record;
}

function published(context: Context = byAdmin, correlationId: string | null = null) {
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

describe('an event published to a playbook, as the follower reads it', () => {
  it('is the event at depth 1 when sent from outside, owned by no workflow', () => {
    expect(published()).toEqual({ event: told, depth: 1, emitter: undefined, ownedBy: [], topRun: undefined });
  });

  it('when a run emitted it, is owned by the workflow of that run, and names the run that began the chain', () => {
    expect([published(emittedBy, 'r-top'), published(emittedBy, 'r-nested'), published(emittedBy)]).toMatchObject([
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
      published(withoutDepth),
      published({ ...byAdmin, runId: 'r-nested', definitionType: 'reasoning', definitionName: 'sum' }),
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

  it('is none for the records of a call made by hand, which no recall function folds and no trigger takes, with no note', () => {
    const called = { call_id: 'c-1', server: 'graph', tool: 'search', arguments_bytes: 2 };

    expect([
      followedEventOf(recordOf('tool-calls/c-1', { type: 'tool_call_started', data: called }), 'workflow'),
      followedEventOf(recordOf('tool-calls/c-1', { type: 'tool_call_answered', data: called }), 'workflow'),
      followedEventOf(recordOf('tool-calls/c-1', { type: 'tool_call_started' }), 'recall'),
    ]).toEqual(['none', 'none', 'none']);
  });
});

describe('the reads and tellings of a conversation, as the follower meets them', () => {
  it('are none, which no recall function folds and no trigger takes', () => {
    const read = { call_id: 'c-1', server: 'chat', tool: 'thread_replies' };

    expect([
      followedEventOf(recordOf('conversation-calls/c-1', { type: 'replies_read', data: read }), 'workflow'),
      followedEventOf(recordOf('conversation-calls/c-1', { type: 'telling_started', data: read }), 'recall'),
    ]).toEqual(['none', 'none']);
  });
});
