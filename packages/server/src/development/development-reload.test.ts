import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { endingOf, runningDevelopment } from '../testing/processes/development-endings.ts';
import {
  developmentFiles,
  pidsOf,
  restartMarkLeftBy,
  startDevelopment,
  untilListening,
  untilWritten,
  writeServerEntry,
  writeServerEntryStartingAfter,
} from '../testing/processes/development-process.ts';
import { gatewayThatHangsFirst, settledOver, welcomingStarted } from '../testing/processes/workflow-process.ts';
import { until } from '../testing/waiting/until.ts';

const runnerSays = /changed, so the server restarts$|^The server stopped/u;

describe('saving a file under pnpm dev', () => {
  it('restarts the server once through its clean shutdown, and leaves nothing running when stopped', async () => {
    const development = await runningDevelopment();

    writeFileSync(join(development.files.sourceDirectory, 'saved.ts'), 'export const saved = true;\n');
    await untilListening(development, 2);
    development.signal('SIGTERM');

    await expect(endingOf(development)).resolves.toEqual({
      exitCode: 0,
      said: [`${join(development.files.sourceDirectory, 'saved.ts')} changed, so the server restarts`],
    });
    expect(pidsOf(development)).toHaveLength(2);
  });
});

describe('the restart mark under pnpm dev', () => {
  it('is left with the pid of the runner while the server restarts, so an agent waits for it, and cleared once the server serves again', async () => {
    const development = await runningDevelopment();
    const leftBefore = restartMarkLeftBy(development);

    writeServerEntryStartingAfter(development.files, 1000);
    const left = await until(
      () => restartMarkLeftBy(development),
      (mark) => mark !== undefined,
    );
    await untilListening(development, 2);
    const leftAfter = restartMarkLeftBy(development);
    development.signal('SIGTERM');
    await endingOf(development);

    expect({ leftBefore, left, leftAfter }).toMatchObject({
      leftBefore: undefined,
      left: { pid: development.pid },
      leftAfter: undefined,
    });
  });

  it('is cleared when the server it restarts stops before it serves', async () => {
    const development = await runningDevelopment();

    writeServerEntry(development.files, 'this is not TypeScript (\n');
    await untilWritten(development.stderr, /The server stopped \(exit code 1\)/u);
    const left = restartMarkLeftBy(development);
    development.signal('SIGTERM');
    await endingOf(development);

    expect(left).toBeUndefined();
  });
});

describe('a broken save under pnpm dev', () => {
  it('keeps running when the server cannot start, and starts it on the next save', async () => {
    const development = await runningDevelopment();

    writeServerEntry(development.files, 'this is not TypeScript (\n');
    await untilWritten(development.stderr, /The server stopped \(exit code 1\)/u);
    writeServerEntry(development.files);
    await untilListening(development, 2);
    development.signal('SIGTERM');

    const { exitCode, said } = await endingOf(development);

    expect({ exitCode, said: said.filter((line) => runnerSays.test(line)) }).toEqual({
      exitCode: 0,
      said: [
        `${development.files.serverEntry} changed, so the server restarts`,
        'The server stopped (exit code 1); it starts again when a file changes',
        `${development.files.serverEntry} changed, so the server restarts`,
      ],
    });
  });
});

describe('a server crash under pnpm dev', () => {
  it('keeps running when the server dies while a workflow waits on a function, and on the next save the run goes on', async () => {
    const gateway = await gatewayThatHangsFirst();
    const development = startDevelopment(developmentFiles(), { environment: { MODEL_GATEWAYS: gateway.gateways } });
    const runId = await welcomingStarted(await untilListening(development), 'delta');
    await gateway.firstHeard;

    development.signal('SIGUSR2');
    await untilWritten(development.stderr, /The server stopped \(signal SIGKILL\)/u);
    appendFileSync(development.files.envFile, '# saved\n');
    const settled = await settledOver(await untilListening(development, 2), `/delta/runs/${runId}`);
    development.signal('SIGTERM');

    expect(settled).toMatchObject({ status: 'succeeded', output: 'Welcome, Ada.' });
    expect(gateway.requests()).toBe(2);
    await expect(endingOf(development)).resolves.toEqual({
      exitCode: 0,
      said: [
        'The server stopped (signal SIGKILL); it starts again when a file changes',
        `${development.files.envFile} changed, so the server restarts`,
      ],
    });
  });
});
