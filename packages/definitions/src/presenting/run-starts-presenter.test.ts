import { presentationOf, type Context, type RecordedEvent } from '@on.auto/operations';
import { nothingKept } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { makeDefinitionPresenters } from '../index.ts';
import type { RunEvent } from '../runs/run-events.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { testRunId as runId } from '../testing/run-facts.ts';

const { present } = presentationOf(makeDefinitionPresenters([echo]));

const ofGreet: Context = {
  runId,
  by: 'acme-admin',
  at: '2026-10-01T09:00:01.000Z',
  definitionType: 'echo',
  definitionName: 'greet',
  definitionVersion: 2,
};

function recorded(event: RunEvent, context: Context): RecordedEvent {
  return {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
    causationId: '1c2d3e4f-5a6b-5c7d-8e9f-a0b1c2d3e4f5',
    correlationId: runId,
    stream: `runs/${runId}`,
    version: 1,
    globalPosition: 1,
    type: event.type,
    data: event.data,
    context,
    recordedAt: '2026-10-01T09:00:02.000Z',
  };
}

function presented(event: RunEvent, context: Context = ofGreet) {
  const showing = { streamPrefix: 'playbook/acme/alpha/', content: nothingKept, view: 'page' } as const;
  return present(recorded(event, context), showing).at(0);
}

describe('the presenter of a run that answers a call of another run', () => {
  it('shows the call it answers in the metadata of its start', () => {
    const calledBy = { runId: '0199a3c4-7d2e-7c1a-9b3f-000000000001', reference: '/do/0/ask', run: 2 };

    expect(
      presented({ type: 'run_started', data: { input: {} } }, { ...ofGreet, callDepth: 1, calledBy }),
    ).toMatchObject({
      metadata: {
        call_depth: 1,
        called_by: { run_id: '0199a3c4-7d2e-7c1a-9b3f-000000000001', reference: '/do/0/ask', run: 2 },
      },
    });
  });
});

describe('the presenter of a cancel request', () => {
  it.each([
    ['requested', 'Someone allowed to change the playbook asked for the run to be cancelled.'],
    ['deadline', 'The step that waited for the run ran out of time, so the run is being cancelled.'],
    ['parent_ended', 'The run that waited for this run ended first, so this run is being cancelled.'],
  ] as const)('says who asked for a cancel of the kind %s, with the reason cut at 1 KiB', (kind, summary) => {
    expect(presented({ type: 'run_cancel_requested', data: { kind, reason: 'r'.repeat(2000) } })).toMatchObject({
      type: 'run_cancel_requested',
      summary,
      data: { kind, reason: 'r'.repeat(1024) },
    });
  });

  it('shows a cancelled run with its kind', () => {
    expect(
      presented({
        type: 'run_rejected',
        data: { rejection: { reason: 'cancelled', detail: 'Not needed', kind: 'requested' } },
      }),
    ).toMatchObject({
      summary: 'A run did not go through: it was cancelled at the request of someone allowed to change the playbook.',
      data: { reason: 'cancelled', detail: 'Not needed', kind: 'requested' },
    });
  });
});

function startedBy(kind: 'event' | 'cron' | 'every', reference: string) {
  return presented({ type: 'run_started', data: { input: [] } }, { ...ofGreet, trigger: { kind, reference } });
}

describe('the presenter of the start of a run a trigger started', () => {
  it('says which kind of trigger started it, and gives the trigger with its place in the document in the metadata', () => {
    expect(
      [
        startedBy('event', '/schedule/on'),
        startedBy('cron', '/schedule/cron'),
        startedBy('every', '/schedule/every'),
      ].map((event) => event?.summary),
    ).toEqual([
      'A run of the greeting “greet” was started by its event trigger.',
      'A run of the greeting “greet” was started by its cron schedule.',
      'A run of the greeting “greet” was started by its every schedule.',
    ]);
    expect(startedBy('every', '/schedule/every')).toMatchObject({
      data: { input: [] },
      metadata: { trigger: { kind: 'every', reference: '/schedule/every' } },
    });
  });
});
