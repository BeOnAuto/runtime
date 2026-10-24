import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spawnForTheTest } from '@on.auto/operations/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

const evaluationMessages = new URL('../jobs/evaluation-messages.ts', import.meta.url).href;

const readyAtOnce = new URL(
  `data:text/javascript,${encodeURIComponent(
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
  )}`,
);

function closingWhileUnheard(mark: string): string {
  return [
    `const { programPool } = await import(${JSON.stringify(new URL('program-pool.ts', import.meta.url).href)});`,
    `const { Effect } = await import(${JSON.stringify(import.meta.resolve('effect'))});`,
    "const { existsSync } = await import('node:fs');",
    `const pool = programPool({ handed: { sandbox: {} }, instances: 'fresh', workers: 1, heapMegabytes: 64, evaluationWorker: new URL(${JSON.stringify(readyAtOnce.href)}), environment: { READY_MARK: ${JSON.stringify(mark)} } });`,
    'void Effect.runPromise(pool.evaluations.machine.reserve);',
    `while (!existsSync(${JSON.stringify(mark)})) {}`,
    'await pool.close();',
    "process.stdout.write('closed');",
  ].join('\n');
}

function aMarkToBeWritten(): string {
  const directory = mkdtempSync(join(tmpdir(), 'evaluation-stops-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return join(directory, 'ready');
}

async function endingOf(script: string): Promise<{ readonly code: number | null; readonly printed: string }> {
  const child = spawnForTheTest(process.execPath, ['--eval', script], { stdio: ['ignore', 'pipe', 'inherit'] });
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

describe('an evaluation worker stopped while the readiness it signalled is still unheard', () => {
  it('holds the process until it has ended, so a close awaited with nothing else to do settles', async () => {
    expect(await endingOf(closingWhileUnheard(aMarkToBeWritten()))).toEqual({ code: 0, printed: 'closed' });
  });
});
