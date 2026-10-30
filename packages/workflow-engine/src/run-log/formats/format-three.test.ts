import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { stateFormats, stateInCurrentFormat } from '../../index.ts';

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
    const listening = frame('/do/0/hear', { kind: 'listen', consumed: [], waited: 1 });

    expect(() =>
      stateInCurrentFormat(3, { ...stateOfFormatThree, machine: { ...stateOfFormatThree.machine, root: listening } }),
    ).toThrow(/waited/u);
  });
});
