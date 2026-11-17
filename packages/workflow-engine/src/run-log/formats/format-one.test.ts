import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

const [, , formatThree] = stateFormats.older;

const initialOfFormatThree = Schema.decodeUnknownSync(Schema.JsonObject)(formatThree?.initial);

function frame(reference: string, body: Schema.JsonObject): Schema.JsonObject {
  return { reference, run: 1, startedAt: 0, context: 0, rawInput: 0, input: 0, variables: {}, timeout: null, body };
}

const error = { type: 'communication', status: 503, instance: '/do/0/all', kind: 'listen' };

const cursor = { pointer: '/do/0/all/fork/branches/2/each/do', position: 0, data: 0, variables: {} };

const forkOfFormatThree = frame('/do/0/all', {
  kind: 'fork',
  compete: false,
  branches: [
    { state: 'running', task: frame('/do/0/all/fork/branches/0/hear', { kind: 'listen', consumed: [] }) },
    {
      state: 'running',
      task: frame('/do/0/all/fork/branches/1/guarded', {
        kind: 'try',
        attempt: 0,
        startedAt: 0,
        phase: { kind: 'backing_off', timer: '2', error },
      }),
    },
    {
      state: 'running',
      task: frame('/do/0/all/fork/branches/2/each', {
        kind: 'list',
        list: { ...cursor, current: { kind: 'yielding', timer: '3' } },
      }),
    },
    { state: 'yielding', timer: '4' },
    { state: 'failed', error, order: 0 },
  ],
});

const stateOfFormatThree = {
  ...initialOfFormatThree,
  status: 'running',
  machine: { values: { 0: { value: {}, bytes: 2 } }, nextValue: 1, context: 0, root: forkOfFormatThree },
};

const CorpusStateSchema = Schema.Struct({ state: Schema.Json });

const { state: stateOfFormatFour } = Schema.decodeUnknownSync(Schema.fromJsonString(CorpusStateSchema))(
  readFileSync(fileURLToPath(new URL('../../../corpus/format-4.json', import.meta.url)), 'utf8'),
);

const [, , , formatFour] = stateFormats.older;

const listening = '/do/0/all/fork/branches/1/both';

function replaced(state: Schema.Json, before: string, after: string): Schema.Json {
  return toJson(JSON.parse(JSON.stringify(state).replaceAll(before, after)));
}

const CorpusStateSchemaFormatFive = Schema.Struct({ state: Schema.JsonObject });

const { state: stateOfFormatFive } = Schema.decodeUnknownSync(Schema.fromJsonString(CorpusStateSchemaFormatFive))(
  readFileSync(fileURLToPath(new URL('../../../corpus/format-5.json', import.meta.url)), 'utf8'),
);

const [, , , , formatFive] = stateFormats.older;

const cancelledState = { ...stateOfFormatFive, status: 'ended', outcome: { kind: 'cancelled' } };

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

describe('a state of format 3', () => {
  it('is read strictly as format 3 and upcast with the input before a yield or a back-off, and one wait of each listen', () => {
    const upcast = stateInCurrentFormat(3, stateOfFormatThree);

    expect(formatThree?.format).toBe(3);
    expect(upcast.machine.root?.body).toEqual({
      kind: 'fork',
      compete: false,
      branches: [
        {
          state: 'running',
          task: frame('/do/0/all/fork/branches/0/hear', { kind: 'listen', consumed: [], waited: 1 }),
        },
        {
          state: 'running',
          task: frame('/do/0/all/fork/branches/1/guarded', {
            kind: 'try',
            attempt: 0,
            startedAt: 0,
            phase: { kind: 'backing_off', timer: '2', error, failed: 'input' },
          }),
        },
        {
          state: 'running',
          task: frame('/do/0/all/fork/branches/2/each', {
            kind: 'list',
            list: { ...cursor, current: { kind: 'yielding', timer: '3', after: 'input' } },
          }),
        },
        { state: 'yielding', timer: '4' },
        { state: 'failed', error, order: 0 },
      ],
    });
  });

  it('refuses a member format 3 does not describe, such as one format 4 adds', () => {
    const listeningFormatThree = frame('/do/0/hear', { kind: 'listen', consumed: [], waited: 1 });

    expect(() =>
      stateInCurrentFormat(3, {
        ...stateOfFormatThree,
        machine: { ...stateOfFormatThree.machine, root: listeningFormatThree },
      }),
    ).toThrow(/waited/u);
  });
});

describe('a state of format 4', () => {
  it('is upcast with no offers, no emissions, and a listener for each open listen whose filters name a type', () => {
    const upcast = stateInCurrentFormat(4, stateOfFormatFour);

    expect(formatFour?.format).toBe(4);
    expect([upcast.inbox.offeredIds, upcast.emitted, Object.values(upcast.listeners)]).toEqual([
      [],
      { count: 0, bytes: 0 },
      [{ runId: upcast.runId, reference: listening, run: 1 }],
    ]);
  });

  it('gives no listener to a listen whose filters name no type', () => {
    const untyped = replaced(stateOfFormatFour, '"with":{"type":"first"}', '"with":{"source":"/first"}');
    const typeless = replaced(untyped, '"with":{"type":"second"}', '"with":{"source":"/second"}');

    expect(stateInCurrentFormat(4, typeless).listeners).toEqual({});
  });

  it('is read strictly as format 4, so a state with what format 5 added is refused', () => {
    const withOffers = replaced(stateOfFormatFour, '"receivedIds":', '"offeredIds":[],"receivedIds":');

    expect(() => stateInCurrentFormat(4, withOffers)).toThrow(/excess property/u);
  });
});

describe('a state of format 5', () => {
  it('is upcast as it is, its limits naming no limit of a task', () => {
    const upcast = stateInCurrentFormat(5, stateOfFormatFive);

    expect(formatFive?.format).toBe(5);
    expect(upcast.limits).toEqual({ mostDurationMs: 2_592_000_000, longestCallMs: 600_000 });
  });

  it('is upcast from a cancelled run with a cancellation that names no one, since format 5 kept no actor or reason', () => {
    expect(stateInCurrentFormat(5, cancelledState).outcome).toEqual({
      kind: 'cancelled',
      cancel: {
        by: 'unknown',
        kind: 'requested',
        reason: 'The run was cancelled before a cancellation said who asked for it and why',
      },
    });
  });

  it('is read strictly as format 5, so a state with what format 6 added is refused', () => {
    const withCancel = {
      ...cancelledState,
      outcome: { kind: 'cancelled', cancel: { by: 'acme-admin', kind: 'requested', reason: 'No' } },
    };

    expect(() => stateInCurrentFormat(5, withCancel)).toThrow(/excess property/u);
  });
});
