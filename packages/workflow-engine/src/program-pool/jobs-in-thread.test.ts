import { describe, expect, it } from 'vitest';

import { moduleOfSource } from '../pool-testing/source-modules.ts';
import { handlersServedDuring } from './job-loop.ts';

const loop = new URL('./job-loop.ts', import.meta.url).href;

describe('the handlers of a worker module imported where no worker runs it', () => {
  it('are claimed from the jobs it serves as it loads', async () => {
    const answer = { ran: 'answered', output: 'null', bytes: 4, work: 0 };
    const module = moduleOfSource(
      `import { serveJobs } from '${loop}';\nserveJobs({ program: () => (${JSON.stringify(answer)}) });`,
    )();

    const handlersOf = await handlersServedDuring(() => import(module.href));

    expect(Object.keys(handlersOf(() => new Uint8Array()))).toEqual(['program']);
  });

  it('are none of a module that serves no jobs, which is refused', async () => {
    const module = moduleOfSource('export const nothing = 1;')();

    await expect(handlersServedDuring(() => import(module.href))).rejects.toThrow(/serves no jobs/u);
  });
});
