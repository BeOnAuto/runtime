import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { stateFormats, stateInCurrentFormat } from '../../index.ts';
import { at, runId } from '../../testing/runs.ts';

const toJson = Schema.decodeUnknownSync(Schema.Json);

const [formatOne] = stateFormats.older;

const initialOfFormatOne = Schema.decodeUnknownSync(Schema.JsonObject)(formatOne?.initial);

const machineOfFormatOne = { values: { 0: { value: {}, bytes: 2 } }, nextValue: 1, context: 0 };

const askingOfFormatOne = {
  reference: '/do/0/race/fork/branches/3/ask',
  run: 1,
  rawInput: 0,
  input: 0,
  variables: {},
  timeout: null,
  body: {
    kind: 'call',
    key: { executionId: runId, reference: '/do/0/race/fork/branches/3/ask', run: 1 },
    function: 'notify',
    arguments: 0,
    label: 'notify',
  },
};

const frameOfFormatOne = {
  reference: '/do/0/race',
  run: 1,
  rawInput: 0,
  input: 0,
  variables: {},
  timeout: null,
  body: {
    kind: 'fork',
    compete: true,
    branches: [
      { state: 'failed', error: { type: 'runtime', status: 500, instance: '/a' } },
      {
        state: 'running',
        task: {
          reference: '/do/0/race/fork/branches/1/pause',
          run: 1,
          rawInput: 0,
          input: 0,
          variables: {},
          timeout: null,
          body: { kind: 'wait', timer: `${runId}/timers/1` },
        },
      },
      { state: 'failed', error: { type: 'runtime', status: 500, instance: '/c' } },
      { state: 'running', task: askingOfFormatOne },
    ],
  },
};

const waitTimer = { purpose: 'wait', reference: '/do/0/race', dueAt: at + 5000 };

const askDeadline = { purpose: 'call_deadline', reference: askingOfFormatOne.reference, dueAt: at + 60_000 };

function runningOfFormatOne(root: unknown, armed: Readonly<Record<string, unknown>>): Schema.Json {
  return toJson({
    ...initialOfFormatOne,
    executionId: runId,
    status: 'running',
    lastInputAt: at,
    timers: { next: 3, armed },
    machine: { ...machineOfFormatOne, root },
  });
}

const stateOfFormatOne = runningOfFormatOne(frameOfFormatOne, {
  [`${runId}/timers/1`]: waitTimer,
  [`${runId}/timers/2`]: askDeadline,
});

describe('a state of format 1', () => {
  it('is upcast to the current format: frames start at the last input with the context then, armed timers armed then, failures ordered as their branches, and a call knows its deadline', () => {
    const upcast = stateInCurrentFormat(1, stateOfFormatOne);

    expect(upcast.timers.armed).toEqual({
      [`${runId}/timers/1`]: { ...waitTimer, armedAt: at },
      [`${runId}/timers/2`]: { ...askDeadline, armedAt: at },
    });
    expect(upcast.machine.root).toMatchObject({
      startedAt: at,
      context: 0,
      body: {
        branches: [
          { state: 'failed', order: 0 },
          { state: 'running', task: { startedAt: at, context: 0 } },
          { state: 'failed', order: 2 },
          { state: 'running', task: { body: { kind: 'call', deadline: `${runId}/timers/2` } } },
        ],
      },
    });
  });
});

describe('the inbox of a state of format 1', () => {
  it('keeps of its inbox what format 2 holds, and no longer the overflow no runtime wrote', () => {
    expect(stateInCurrentFormat(1, stateOfFormatOne).inbox).toEqual({
      waiting: [],
      waitingBytes: 0,
      receivedIds: [],
      offeredIds: [],
      received: 0,
      receivedBytes: 0,
    });
  });

  it('is read strictly as format 1, so a state of another format is refused before it is upcast', () => {
    expect(formatOne?.format).toBe(1);
    expect(() => stateInCurrentFormat(1, toJson({ ...initialOfFormatOne, extra: true }))).toThrow(/extra/u);
  });

  it('does not load when a list in it stands between its tasks, which format 2 has no way to hold and no runtime wrote', () => {
    const between = { pointer: '/do', position: 1, data: 0, variables: {}, current: null };
    const root = { ...frameOfFormatOne, body: { kind: 'list', list: between } };

    expect(() => stateInCurrentFormat(1, runningOfFormatOne(root, {}))).toThrow(/current/u);
  });

  it('does not load when a call in it has no deadline armed, which every call of format 1 armed', () => {
    expect(() =>
      stateInCurrentFormat(1, runningOfFormatOne(frameOfFormatOne, { [`${runId}/timers/1`]: waitTimer })),
    ).toThrow(/deadline/u);
  });
});
