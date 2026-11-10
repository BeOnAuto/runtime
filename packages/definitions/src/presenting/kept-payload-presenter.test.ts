import {
  presentationOf,
  type Context,
  type EventView,
  type KeptContent,
  type RecordedEvent,
} from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { makeDefinitionPresenters } from '../index.ts';
import type { RunEvent } from '../runs/run-events.ts';
import { recordedAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { keptArmOf } from '../testing/kept-payloads.ts';
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

const input = { who: 'Ada', notes: 'n'.repeat(3000) };

const output = { greeting: 'Hi', letter: 'l'.repeat(3000) };

const answer = { approved: true, reason: 'r'.repeat(3000) };

const [inputKept, outputKept, answerKept] = [keptArmOf(input), keptArmOf(output), keptArmOf(answer)];

const texts: Readonly<Record<string, string>> = {
  [inputKept.sha256]: JSON.stringify(input),
  [outputKept.sha256]: JSON.stringify(output),
  [answerKept.sha256]: 'not JSON',
};

const everythingRead: KeptContent = (sha256) => texts[sha256];

const nothingRead: KeptContent = () => {};

function recorded(event: RunEvent): RecordedEvent {
  return {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
    causationId: null,
    correlationId: testRunId,
    stream: `runs/${testRunId}`,
    version: 1,
    globalPosition: 11,
    type: event.type,
    data: event.data,
    context: ofGreet,
    recordedAt: '2026-10-01T09:00:02.000Z',
  };
}

function presented(event: RunEvent, content: KeptContent, view: EventView) {
  return present(recorded(event), { streamPrefix: 'playbook/acme/alpha/', content, view }).at(0)?.data;
}

const started: RunEvent = {
  type: 'run_started',
  data: { input_sha256: inputKept.sha256, input_bytes: inputKept.bytes, started_by: recordedAdmin },
};

const succeeded: RunEvent = {
  type: 'run_succeeded',
  data: { output_sha256: outputKept.sha256, output_bytes: outputKept.bytes, record: { model: 'x' } },
};

const answered: RunEvent = {
  type: 'request_answered',
  data: { answer_sha256: answerKept.sha256, answer_bytes: answerKept.bytes, answered_by: recordedAdmin },
};

describe('the events of a run whose payloads its playbook keeps outside the run', () => {
  it('show each payload on a page as stored, its digest and its size, as a large value already shows as its size', () => {
    expect([started, succeeded, answered].map((event) => presented(event, nothingRead, 'page'))).toEqual([
      { input_sha256: inputKept.sha256, input_bytes: inputKept.bytes, started_by: recordedAdmin },
      { output_sha256: outputKept.sha256, output_bytes: outputKept.bytes, record: { model: 'x' } },
      { answer_sha256: answerKept.sha256, answer_bytes: answerKept.bytes, answered_by: recordedAdmin },
    ]);
  });

  it('show the value whole beside its digest and size where the payload was read, as get_event reads it', () => {
    expect([presented(started, everythingRead, 'whole'), presented(succeeded, everythingRead, 'whole')]).toEqual([
      { input_sha256: inputKept.sha256, input_bytes: inputKept.bytes, started_by: recordedAdmin, input },
      { output_sha256: outputKept.sha256, output_bytes: outputKept.bytes, record: { model: 'x' }, output },
    ]);
  });

  it('show a payload whose text read is not JSON as its digest and size alone', () => {
    expect(presented(answered, everythingRead, 'whole')).toEqual({
      answer_sha256: answerKept.sha256,
      answer_bytes: answerKept.bytes,
      answered_by: recordedAdmin,
    });
  });
});
