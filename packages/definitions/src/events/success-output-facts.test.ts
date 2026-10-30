import type { Context, RecordedEvent } from '@on.auto/operations';
import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { jsonBytesOf } from '../runs/recorded-size.ts';
import { runStreamNameOf } from '../runs/run-decider.ts';
import type { RunEvent } from '../runs/run-events.ts';
import { testRunId as runId } from '../testing/run-facts.ts';
import { mostPublishedEventBytes } from './cloud-event.ts';
import { playbookFactOf } from './playbook-facts.ts';

const at = '2026-10-01T09:00:05.000Z';

const ofSummary: Context = {
  at,
  by: 'acme-admin',
  runId,
  definitionType: 'reasoning',
  definitionName: 'summary',
  definitionVersion: 3,
};

function ofRun(event: RunEvent): RecordedEvent {
  return {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    cursor: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    causationId: null,
    correlationId: null,
    version: 1,
    globalPosition: 1,
    recordedAt: at,
    stream: runStreamNameOf(runId),
    type: event.type,
    data: event.data,
    context: ofSummary,
  };
}

const aboutTheRun = {
  specversion: '1.0',
  id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
  source: `/runs/${runId}`,
  subject: 'reasoning/summary',
  time: at,
  caller: 'acme-admin',
  definitionversion: 3,
};

function deep(levels: number): Schema.Json {
  return levels === 0 ? 'rose' : { profits: deep(levels - 1) };
}

function succeededWith(output: Schema.Json) {
  return playbookFactOf(ofRun({ type: 'run_succeeded', data: { output, record: {} } }));
}

describe('the output a success carries as an event', () => {
  it('is its size when it is too large for an event, which get_run reads whole', () => {
    const output = { summary: 'x'.repeat(mostPublishedEventBytes) };

    expect(succeededWith(output)).toEqual({
      ...aboutTheRun,
      type: 'run_succeeded',
      data: { output_bytes: jsonBytesOf(output) },
    });
  });

  it('is its size when it nests too deep for a run to hold the event in a list', () => {
    expect(succeededWith(deep(509))).toHaveProperty('data.output', deep(509));
    expect(succeededWith(deep(510))).toHaveProperty('data.output_bytes', jsonBytesOf(deep(510)));
  });

  it('is the output at the bound of an event, and its size one byte past it', () => {
    const empty = { ...aboutTheRun, type: 'run_succeeded', data: { output: '' } };
    const room = mostPublishedEventBytes - jsonBytesOf(empty);
    const fitting = 'x'.repeat(room);

    expect(succeededWith(fitting)).toHaveProperty('data.output', fitting);
    expect(succeededWith(`${fitting}x`)).toHaveProperty('data.output_bytes', room + 3);
  });
});
