import { afterEach, describe, expect, it } from 'vitest';

import { handedSandbox } from '../pool-testing/test-pools.ts';
import type { Evaluation } from '../programs/program-run.ts';
import { serveEvaluations } from './evaluation-loop.ts';

type Ask = (request: unknown) => Promise<unknown>;

interface Served {
  readonly ask: Ask;
  readonly tell: (request: unknown) => void;
}

const channels: MessageChannel[] = [];

const now = Date.parse('2026-10-01T09:00:00.000Z');

afterEach(() => {
  for (const { port1, port2 } of channels.splice(0)) {
    port1.close();
    port2.close();
  }
});

function servedHere(): Served {
  const channel = new MessageChannel();
  channels.push(channel);
  serveEvaluations({
    port: channel.port1,
    flags: new SharedArrayBuffer(2 * Int32Array.BYTES_PER_ELEMENT),
    handed: handedSandbox,
  });
  return {
    ask: (request) => {
      const { promise, resolve } = Promise.withResolvers<unknown>();
      channel.port2.once('message', resolve);
      channel.port2.postMessage(request, []);
      return promise;
    },
    tell: (request) => {
      channel.port2.postMessage(request, []);
    },
  };
}

function absoluteIn(milliseconds: number): Evaluation {
  return { budget: 250, deadlineAt: performance.timeOrigin + performance.now() + milliseconds, moment: now };
}

function evaluating(source: string) {
  return { kind: 'evaluate', unit: 2, source, names: ['data'], texts: ['20'], evaluation: absoluteIn(10_000) };
}

describe('the loop of the evaluation worker, served on the thread of a test', () => {
  it('answers a request it cannot read and a test of a unit it never prepared with the words of each', async () => {
    const { ask } = servedHere();

    const answers = [
      await ask({ kind: 'guess' }),
      await ask({ kind: 'test', unit: 9, test: 0, value: 'null', evaluation: absoluteIn(10_000) }),
    ];

    expect(answers).toMatchObject([
      { ran: 'raised', issue: { detail: 'The evaluation worker could not read the request' } },
      { ran: 'raised', issue: { detail: 'The evaluation worker holds no test 0 of unit 9' } },
    ]);
  });

  it('prepares the filters of a unit, tests each, and lets them go when told', async () => {
    const { ask, tell } = servedHere();

    const prepared = await ask({ kind: 'prepare', unit: 1, sources: [' $data == 1 '], evaluation: absoluteIn(10_000) });
    const tested = await ask({ kind: 'test', unit: 1, test: 0, value: '1', evaluation: absoluteIn(10_000) });
    tell({ kind: 'close', unit: 1 });
    tell({ kind: 'close', unit: 7 });
    const gone = await ask({ kind: 'test', unit: 1, test: 0, value: '1', evaluation: absoluteIn(10_000) });

    expect([prepared, tested]).toEqual([
      { ran: 'answered', text: 'null', work: 0 },
      { ran: 'answered', text: 'true', work: 0 },
    ]);
    expect(gone).toMatchObject({ ran: 'raised' });
  });

  it('answers the filters of a unit whose sources did not freeze in time with that ending', async () => {
    const { ask } = servedHere();

    const prepared = await ask({ kind: 'prepare', unit: 1, sources: [' true '], evaluation: absoluteIn(-1000) });

    expect(prepared).toMatchObject({ ran: 'exhausted', limit: 'deadline' });
  });
});

describe('a unit of expressions the loop of the evaluation worker holds', () => {
  it('keeps a unit of expressions from one evaluation to the next until told to let it go', async () => {
    const { ask, tell } = servedHere();

    const answers = [await ask(evaluating('$data + 1')), await ask(evaluating('$data + 2'))];
    tell({ kind: 'close', unit: 2 });

    expect(answers).toMatchObject([
      { ran: 'answered', text: '21' },
      { ran: 'answered', text: '22' },
    ]);
  });
});
