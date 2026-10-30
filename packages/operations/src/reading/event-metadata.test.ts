import { describe, expect, it } from 'vitest';

import { eventMetadataOf, type RecordedEvent } from '../index.ts';

const at = '2026-10-05T09:00:00.000Z';

const recorded: RecordedEvent = {
  id: 'm-4',
  cursor: 'c-4',
  causationId: 'm-3',
  correlationId: 'r-top',
  stream: 'runs/r-1',
  version: 4,
  globalPosition: 1042,
  type: 'run_succeeded',
  data: {},
  context: { at, by: 'playbook:sales' },
  recordedAt: at,
};

describe('the metadata of an event', () => {
  it('holds the place of the event in its stream and in the store, its chain, and who acted when', () => {
    expect(eventMetadataOf(recorded, 'playbook/acme/sales/')).toEqual({
      stream: 'playbook/acme/sales/runs/r-1',
      position: 4,
      global_position: 1042,
      correlation_id: 'r-top',
      causation_id: 'm-3',
      at,
      by: 'playbook:sales',
    });
  });
});

const ofARun: RecordedEvent = {
  ...recorded,
  traceId: 't-1',
  spanId: 's-1',
  context: {
    at,
    by: 'key-1',
    runId: 'r-1',
    definitionType: 'workflow',
    definitionName: 'nightly',
    definitionVersion: 3,
    calledBy: { runId: 'r-0', reference: '/do/0/ask', run: 2 },
    callDepth: 1,
    depth: 2,
    trigger: { kind: 'event', reference: '/schedule/on' },
  },
};

describe('the metadata of an event of a run', () => {
  it('holds every field of the context under its wire name, in the order a reader reads them', () => {
    const metadata = eventMetadataOf(ofARun, 'playbook/acme/sales/');

    expect(Object.keys(metadata)).toEqual([
      'stream',
      'position',
      'global_position',
      'correlation_id',
      'causation_id',
      'at',
      'by',
      'run_id',
      'definition',
      'called_by',
      'call_depth',
      'depth',
      'trigger',
      'trace_id',
      'span_id',
    ]);
    expect(metadata).toMatchObject({
      run_id: 'r-1',
      definition: { type: 'workflow', name: 'nightly', version: 3 },
      called_by: { run_id: 'r-0', reference: '/do/0/ask', run: 2 },
      call_depth: 1,
      depth: 2,
      trigger: { kind: 'event', reference: '/schedule/on' },
      trace_id: 't-1',
      span_id: 's-1',
    });
  });

  it('names a definition without a version where the fact names none, and none where the context lacks its name', () => {
    const retired = {
      ...recorded,
      context: { at, by: 'key-1', definitionType: 'workflow', definitionName: 'nightly' },
    };
    const typeAlone = { ...recorded, context: { at, by: 'key-1', definitionType: 'workflow' } };

    expect(eventMetadataOf(retired, '').definition).toEqual({ type: 'workflow', name: 'nightly' });
    expect('definition' in eventMetadataOf(typeAlone, '')).toBe(false);
  });
});
