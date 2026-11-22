import { describe, expect, it } from 'vitest';

import { aRunner } from '../testing/processes/pnpm-dev-in-process.ts';

describe('the runner of pnpm dev, told a file changed', () => {
  it('stops its server with SIGTERM and starts another, leaving the mark of its pid and the served port until that one serves', async () => {
    const runner = aRunner();
    const first = await runner.child(0);
    first.says('Auto Runtime listening on port 5555\n');

    await runner.saved('/the/server/saved.ts');
    const second = await runner.child(1);
    const leftWhileRestarting = [...runner.marks.left];
    const clearedBeforeServing = runner.marks.cleared.length;
    second.says('Auto Runtime listening on port 5555\n');
    const clearedOnceServing = runner.marks.cleared.length - clearedBeforeServing;
    runner.stopped('SIGTERM');

    expect(await runner.exitCode).toBe(0);
    expect([first.signalled(), second.signalled()]).toEqual([['SIGTERM'], ['SIGTERM']]);
    expect(leftWhileRestarting).toEqual([[42, 5555]]);
    expect(clearedOnceServing).toBeGreaterThan(0);
  });

  it('leaves no mark when its server never said which port it serves', async () => {
    const runner = aRunner();
    await runner.child(0);

    await runner.saved('/the/server/saved.ts');
    await runner.child(1);
    runner.stopped('SIGINT');

    expect(await runner.exitCode).toBe(0);
    expect(runner.marks.left).toEqual([]);
  });
});

describe('the runner of pnpm dev, whose server stops by itself', () => {
  it.each(['exit code 1', 'signal SIGKILL'])(
    'keeps running when its server ends with %s, clears its mark, starts none until a file changes, then starts one',
    async (reason) => {
      const runner = aRunner();
      const first = await runner.child(0);
      first.says('Auto Runtime listening on port 5555\n');
      await runner.saved('/the/server/broken.ts');
      const second = await runner.child(1);
      const clearedBefore = runner.marks.cleared.length;
      const asksBefore = runner.asks.count();

      second.ends(reason);
      await runner.asks.past(asksBefore);
      const afterTheEnd = { cleared: runner.marks.cleared.length - clearedBefore, started: runner.started() };
      await runner.saved('/the/server/fixed.ts');
      const third = await runner.child(2);
      runner.stopped('SIGHUP');

      expect(await runner.exitCode).toBe(0);
      expect(afterTheEnd).toEqual({ cleared: 1, started: 2 });
      expect(third.signalled()).toEqual(['SIGTERM']);
    },
  );
});

describe('the runner of pnpm dev, told to stop while its server runs', () => {
  it('starts no server again for a change it is told after, clears its mark and exits 0', async () => {
    const runner = aRunner();
    const first = await runner.child(0);
    first.says('Auto Runtime listening on port 5555\n');

    runner.stopped('SIGTERM');
    await runner.saved('/the/server/saved.ts');

    expect(await runner.exitCode).toBe(0);
    expect([runner.started(), runner.marks.cleared]).toEqual([1, expect.arrayContaining([42])]);
  });
});

describe('the runner of pnpm dev, told to stop while its server restarts', () => {
  it('starts no server again once the server it stopped has ended, and exits 0', async () => {
    const runner = aRunner({ holdsOn: true });
    const first = await runner.child(0);
    first.says('Auto Runtime listening on port 5555\n');

    await runner.saved('/the/server/saved.ts');
    runner.stopped('SIGTERM');
    first.ends('signal SIGKILL');
    const ending = await Promise.race([
      runner.exitCode.then((exitCode) => ({ exitCode })),
      runner.child(1).then(() => 'started again'),
    ]);

    expect(ending).toEqual({ exitCode: 0 });
    expect([runner.started(), first.signalled()]).toEqual([1, ['SIGTERM']]);
  });
});
