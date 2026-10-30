import { appendFileSync } from 'node:fs';

import { describe, expect, it, onTestFinished } from 'vitest';

import { endingOf, runningDevelopment } from '../testing/processes/development-endings.ts';
import {
  developmentFiles,
  pidsOf,
  startDevelopment,
  untilListening,
  untilWritten,
  writeServerEntry,
} from '../testing/processes/development-process.ts';

const serverThatStopsOnlyWhenKilled = [
  "process.on('SIGTERM', () => {});",
  'setInterval(() => {}, 60_000);',
  "process.stdout.write('Auto Runtime listening on port 0\\n');",
].join('\n');

describe('stopping pnpm dev', () => {
  it.each<NodeJS.Signals>(['SIGINT', 'SIGTERM', 'SIGHUP'])(
    'stops the server on %s, leaves nothing running and exits 0',
    async (signal) => {
      const development = await runningDevelopment();

      development.signal(signal);

      await expect(endingOf(development)).resolves.toEqual({ exitCode: 0, said: [] });
    },
  );

  it('stops without starting the server again when told to stop while the server restarts', async () => {
    const files = developmentFiles();
    writeServerEntry(files, serverThatStopsOnlyWhenKilled);
    const development = startDevelopment(files);
    onTestFinished(() => {
      development.signal('SIGUSR2');
    });
    await untilListening(development);

    appendFileSync(files.envFile, '# saved\n');
    await untilWritten(development.stderr, /changed, so the server restarts/u);
    development.signal('SIGTERM');
    development.signal('SIGUSR2');

    await expect(endingOf(development)).resolves.toEqual({
      exitCode: 0,
      said: [`${files.envFile} changed, so the server restarts`],
    });
    expect(pidsOf(development)).toHaveLength(1);
  });
});

describe('killing pnpm dev', () => {
  it('leaves nothing running when the runner itself is killed', async () => {
    const development = await runningDevelopment();

    development.signal('SIGKILL');

    await expect(endingOf(development)).resolves.toEqual({ exitCode: null, said: [] });
  });
});
