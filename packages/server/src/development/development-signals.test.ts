import { describe, expect, it } from 'vitest';

import { endingOf, runningDevelopment } from '../testing/processes/development-endings.ts';

/*
 * Processes, one for each thing only a process shows: a stop signal reaching the runner and passed on to the server it
 * started, and the server ending with a runner that was killed. Which signals stop the runner, and that a stop told
 * while the server restarts starts none again, are rules, proven in process in stop-signals.test.ts and
 * development-run.test.ts.
 */
describe('stopping pnpm dev', () => {
  it('stops the server on SIGTERM, leaves nothing running and exits 0', async () => {
    const development = await runningDevelopment();

    development.signal('SIGTERM');

    await expect(endingOf(development)).resolves.toEqual({ exitCode: 0, said: [] });
  });
});

describe('killing pnpm dev', () => {
  it('leaves nothing running when the runner itself is killed', async () => {
    const development = await runningDevelopment();

    development.signal('SIGKILL');

    await expect(endingOf(development)).resolves.toEqual({ exitCode: null, said: [] });
  });
});
