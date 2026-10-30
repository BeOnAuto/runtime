import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { serveProcessJobs, type ProcessHandlers, type ProcessHost } from './process-loop.ts';
import { wireOf, type ProcessValue } from './process-values.ts';

type Heard = (message: unknown) => void;

interface Served {
  readonly sent: readonly unknown[];
  readonly ask: (message: unknown) => Promise<unknown>;
}

function doubled(payload: ProcessValue): ProcessValue {
  return Number(payload) * 2;
}

function lengthOf(payload: ProcessValue): ProcessValue {
  return Number(Reflect.get(new Object(payload), 'length'));
}

const handlers: ProcessHandlers = {
  double: doubled,
  later: () => Promise.resolve({ values: new Float32Array([1.5]) }),
  length: lengthOf,
  raise: () => {
    throw new Error('raised on purpose');
  },
  allocate: () => Promise.reject(new RangeError('Array buffer allocation failed')),
  reserved: () => ({ $typed: 'Uint8Array', base64: 'AQID' }),
};

function piped(value: ProcessValue): unknown {
  return Option.getOrThrow(wireOf(value));
}

function served(): Served {
  const listeners: Heard[] = [];
  const sent: unknown[] = [];
  const answered: Heard[] = [];
  const host: ProcessHost = {
    send: (message) => {
      sent.push(message);
      answered.shift()?.(message);
      return true;
    },
    on: (_event, listener) => listeners.push(listener),
  };
  serveProcessJobs(handlers, host);
  return {
    sent,
    ask: (message) => {
      const { promise, resolve } = Promise.withResolvers<unknown>();
      answered.push(resolve);
      for (const listener of listeners) {
        listener(message);
      }
      return promise;
    },
  };
}

describe('the loop a process serves its jobs in', () => {
  it('says it is ready, then answers each job with the answer of the handler of its kind, its typed arrays as base64, and keeps the process', async () => {
    const loop = served();

    const twice = await loop.ask({ job: 1, kind: 'double', payload: 21 });
    const later = await loop.ask({ job: 2, kind: 'later', payload: null });

    expect(loop.sent[0]).toEqual({ ready: true });
    expect([twice, later]).toEqual([
      { job: 1, answer: 42, keep: true },
      { job: 2, answer: piped({ values: new Float32Array([1.5]) }), keep: true },
    ]);
  });

  it('reads the typed arrays of a payload back from base64 before its handler sees them', async () => {
    const loop = served();

    expect(await loop.ask({ job: 3, kind: 'length', payload: piped(new Float64Array([1, 2, 3])) })).toEqual({
      job: 3,
      answer: 3,
      keep: true,
    });
  });

  it('serves nothing where the process has no channel to its parent', () => {
    const listeners: Heard[] = [];

    serveProcessJobs(handlers, { on: (_event, listener) => listeners.push(listener) });

    expect(listeners).toEqual([]);
  });
});

describe('a job the loop of a process cannot answer', () => {
  it.each<readonly [string, unknown, unknown]>([
    [
      'a message that is not a job',
      { nonsense: true },
      { job: -1, failed: 'The process could not read the job it was sent' },
    ],
    ['a job it cannot read', { job: 4, kind: 7 }, { job: 4, failed: 'The process could not read the job it was sent' }],
    [
      'a job of a kind it does not serve',
      { job: 5, kind: 'other', payload: null },
      { job: 5, failed: 'This process serves no job of the kind other' },
    ],
    [
      'a job of a name every object has',
      { job: 6, kind: 'toString', payload: null },
      { job: 6, failed: 'This process serves no job of the kind toString' },
    ],
    [
      'a job whose payload it cannot read',
      { job: 7, kind: 'raise', payload: { $typed: 'Nope', base64: '' } },
      { job: 7, failed: 'The process could not read the payload of its job' },
    ],
    [
      'a job its handler raises on',
      { job: 8, kind: 'raise', payload: null },
      { job: 8, failed: 'Error: raised on purpose' },
    ],
    [
      'a job whose handler answers what the pipe cannot carry',
      { job: 9, kind: 'reserved', payload: null },
      { job: 9, failed: 'The process answered with what the pipe cannot carry' },
    ],
  ])('is %s, answered as failed', async (_what, message, answer) => {
    expect(await served().ask(message)).toEqual(answer);
  });

  it('is one whose handler cannot allocate, answered as out of memory, which the pool reads as the end of its process', async () => {
    expect(await served().ask({ job: 10, kind: 'allocate', payload: null })).toEqual({ job: 10, exhausted: 'memory' });
  });
});
