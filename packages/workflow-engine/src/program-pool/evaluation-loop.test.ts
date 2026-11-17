import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spawnForTheTest } from '@on.auto/operations/testing';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import type { Json } from '../dsl/json.ts';
import { moduleOfSource } from '../pool-testing/source-modules.ts';
import { handedSandbox, sourcesUnderTest, type SourceUnderTest } from '../pool-testing/test-pools.ts';
import { argumentTextOf } from '../programs/argument-texts.ts';
import type { Evaluation } from '../programs/program-run.ts';
import { serveEvaluations } from './evaluation-loop.ts';

type Ask = (request: unknown) => Promise<unknown>;

interface Served {
  readonly ask: Ask;
  readonly tell: (request: unknown) => void;
}

const channels: MessageChannel[] = [];

const now = Date.parse('2026-10-01T09:00:00.000Z');

function servedHere(instances: SourceUnderTest['name']): Served {
  const channel = new MessageChannel();
  channels.push(channel);
  serveEvaluations({
    port: channel.port1,
    flags: new SharedArrayBuffer(2 * Int32Array.BYTES_PER_ELEMENT),
    handed: handedSandbox,
    instances,
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

const anyText: unknown = expect.any(String);

function testing(unit: number, value: Json) {
  return { kind: 'test', unit, test: 0, value: argumentTextOf(value), evaluation: absoluteIn(10_000) };
}

function evaluating(source: string) {
  return {
    kind: 'evaluate',
    unit: 2,
    source,
    names: ['data'],
    texts: [argumentTextOf(20)],
    evaluation: absoluteIn(10_000),
  };
}

const evaluationMessages = new URL('../jobs/evaluation-messages.ts', import.meta.url).href;

const readyAtOnce = moduleOfSource(
  [
    "import { writeFileSync } from 'node:fs';",
    "import { workerData } from 'node:worker_threads';",
    `import { readyFlag } from '${evaluationMessages}';`,
    'const flags = new Int32Array(workerData.flags);',
    'Atomics.store(flags, readyFlag, 1);',
    'Atomics.notify(flags, readyFlag);',
    "writeFileSync(process.env.READY_MARK, '');",
    "workerData.port.on('message', () => {});",
  ].join('\n'),
);

const closing = [
  'const [poolModule, effectModule, evaluationWorker, mark] = process.argv.slice(1);',
  'const { programPool } = await import(poolModule);',
  'const { Effect } = await import(effectModule);',
  "const { existsSync } = await import('node:fs');",
  "const pool = programPool({ handed: { sandbox: {} }, instances: 'fresh', workers: 1, heapMegabytes: 64, evaluationWorker: () => new URL(evaluationWorker), environment: { READY_MARK: mark } });",
  'void Effect.runPromise(pool.evaluations.machine.reserve);',
  'while (!existsSync(mark)) {}',
  'await pool.close();',
  "process.stdout.write('closed');",
].join('\n');

function closingWhileUnheard(mark: string): readonly string[] {
  return [
    '--eval',
    closing,
    new URL('program-pool.ts', import.meta.url).href,
    import.meta.resolve('effect'),
    readyAtOnce().href,
    mark,
  ];
}

function aMarkToBeWritten(): string {
  const directory = mkdtempSync(join(tmpdir(), 'evaluation-stops-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return join(directory, 'ready');
}

async function endingOf(
  nodeArguments: readonly string[],
): Promise<{ readonly code: number | null; readonly printed: string }> {
  const child = spawnForTheTest(process.execPath, nodeArguments, { stdio: ['ignore', 'pipe', 'inherit'] });
  const printed = { text: '' };
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    printed.text += chunk;
  });
  const code = await new Promise<number | null>((resolve) => {
    child.once('close', (exitCode: number | null) => {
      resolve(exitCode);
    });
  });
  return { code, printed: printed.text };
}

describe('evaluation loop', () => {
  afterEach(() => {
    for (const { port1, port2 } of channels.splice(0)) {
      port1.close();
      port2.close();
    }
  });

  describe.each(sourcesUnderTest)(
    'the loop of the evaluation worker, served on the thread of a test on $name instances',
    ({ name }) => {
      it('answers a request it cannot read and a test of a unit it never prepared as raised, each with its own words', async () => {
        const { ask } = servedHere(name);

        const answers = [await ask({ kind: 'guess' }), await ask(testing(9, null))];

        expect(answers).toMatchObject([
          { ran: 'raised', issue: { detail: anyText } },
          { ran: 'raised', issue: { detail: anyText } },
        ]);
        expect(answers[0]).not.toEqual(answers[1]);
      });

      it('prepares the filters of a unit, tests each, and lets them go when told', async () => {
        const { ask, tell } = servedHere(name);

        const prepared = await ask({
          kind: 'prepare',
          unit: 1,
          sources: [' $data == 1 '],
          evaluation: absoluteIn(10_000),
        });
        const tested = await ask(testing(1, 1));
        tell({ kind: 'close', unit: 1 });
        tell({ kind: 'close', unit: 7 });
        const gone = await ask(testing(1, 1));

        expect([prepared, tested]).toEqual([
          { ran: 'answered', text: 'null', work: 0 },
          { ran: 'answered', text: 'true', work: 0 },
        ]);
        expect(gone).toMatchObject({ ran: 'raised' });
      });

      it('answers the filters of a unit whose sources did not freeze in time with that ending', async () => {
        const { ask } = servedHere(name);

        const prepared = await ask({ kind: 'prepare', unit: 1, sources: [' true '], evaluation: absoluteIn(-1000) });

        expect(prepared).toMatchObject({ ran: 'exhausted', limit: 'deadline' });
      });
    },
  );

  describe.each(sourcesUnderTest)(
    'a unit of expressions the loop of the evaluation worker holds on $name instances',
    ({ name }) => {
      it('keeps a unit of expressions from one evaluation to the next until told to let it go', async () => {
        const { ask, tell } = servedHere(name);

        const answers = [await ask(evaluating('$data + 1')), await ask(evaluating('$data + 2'))];
        tell({ kind: 'close', unit: 2 });

        expect(answers).toMatchObject([
          { ran: 'answered', text: '21' },
          { ran: 'answered', text: '22' },
        ]);
      });
    },
  );
});

describe('an evaluation worker stopped while the readiness it signalled is still unheard', () => {
  it('holds the process until it has ended, so a close awaited with nothing else to do settles', async () => {
    expect(await endingOf(closingWhileUnheard(aMarkToBeWritten()))).toEqual({ code: 0, printed: 'closed' });
  });
});
