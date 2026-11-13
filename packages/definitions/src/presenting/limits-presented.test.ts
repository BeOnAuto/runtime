import { presentationOf, type Context, type IncompleteReason, type KeptContent } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { makeDefinitionPresenters } from '../index.ts';
import type { RunEvent } from '../runs/run-events.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { testRunId } from '../testing/run-facts.ts';

const { present } = presentationOf(makeDefinitionPresenters([echo]));

const ofGreet: Context = {
  runId: testRunId,
  by: 'acme-admin',
  at: '2026-10-01T09:00:01.000Z',
  definitionType: 'echo',
  definitionName: 'greet',
  definitionVersion: 2,
};

const kept: Readonly<Record<string, string>> = {};

const nothingKept: KeptContent = (sha256) => kept[sha256];

function presented(event: RunEvent) {
  const recorded = {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
    causationId: '1c2d3e4f-5a6b-5c7d-8e9f-a0b1c2d3e4f5',
    correlationId: testRunId,
    stream: `runs/${testRunId}`,
    version: 1,
    globalPosition: 11,
    type: event.type,
    data: event.data,
    context: ofGreet,
    recordedAt: '2026-10-01T09:00:02.000Z',
  };
  return present(recorded, { streamPrefix: 'playbook/acme/alpha/', content: nothingKept, view: 'page' }).at(0);
}

function answeredAt(reason: IncompleteReason) {
  return presented({ type: 'run_succeeded', data: { output: 'Hello', record: {}, incomplete_details: { reason } } });
}

const stopped = { reason: 'conflict', detail: 'The run stopped at a limit' } as const;

describe('the presenter of a run whose answer a limit shaped', () => {
  it('presents the success with the limit it reached, in words that count nothing', () => {
    expect([answeredAt('max_tool_calls'), answeredAt('max_input_tokens'), answeredAt('max_output_tokens')]).toEqual([
      expect.objectContaining({
        summary: 'A run finished with an answer from what it had, after it reached its limit of tool calls.',
        data: { output: 'Hello', record: {}, incomplete_details: { reason: 'max_tool_calls' } },
      }),
      expect.objectContaining({
        summary: 'A run finished with an answer from what it had, after it had read as much as a run may read.',
        data: { output: 'Hello', record: {}, incomplete_details: { reason: 'max_input_tokens' } },
      }),
      expect.objectContaining({
        summary: 'A run finished with an answer cut off at its length limit.',
        data: { output: 'Hello', record: {}, incomplete_details: { reason: 'max_output_tokens' } },
      }),
    ]);
  });
});

describe('the presenter of a run stopped at a limit before it finished', () => {
  it('shows the limit as its because, and says why in words that count nothing', () => {
    expect([
      presented({
        type: 'run_rejected',
        data: { rejection: { ...stopped, kind: 'unworkable', because: 'max_tool_calls' } },
      }),
      presented({
        type: 'run_rejected',
        data: { rejection: { ...stopped, kind: 'effect_unknown', because: 'max_input_tokens' } },
      }),
    ]).toEqual([
      expect.objectContaining({
        summary:
          'A run did not go through: it cannot work as it is written, because it needed more tool calls than a run may make.',
        data: { ...stopped, kind: 'unworkable', because: 'max_tool_calls' },
      }),
      expect.objectContaining({
        summary:
          'A run did not go through: it could not finish after calling a tool that may change something, so whether that happened is not known, because it needed to read more than a run may read.',
        data: { ...stopped, kind: 'effect_unknown', because: 'max_input_tokens' },
      }),
    ]);
  });
});
