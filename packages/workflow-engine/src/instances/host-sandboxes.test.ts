import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { decidedOnce } from '../pool-testing/decided-once.ts';
import { evaluatedAt } from '../pool-testing/evaluation-workers.ts';
import { sourcesUnderTest } from '../pool-testing/test-pools.ts';
import { argumentTextOf } from '../programs/argument-texts.ts';
import type { Evaluation } from '../programs/program-run.ts';
import { filterSandboxOf, hostClock, machineSandboxOf } from './host-sandboxes.ts';
import { sandboxAnswers } from './sandbox-probes.ts';

const evaluation: Evaluation = { budget: 250, deadlineAt: Number.POSITIVE_INFINITY, moment: 0 };

const fits = '"x".repeat(16 * 1024 * 1024).length';

const overflows = '"x".repeat(96 * 1024 * 1024).length';

describe.each(sourcesUnderTest)('the sandboxes of a host on the $name source', ({ source }) => {
  it('reserves an instance of 64 MiB for each input of a workflow, read against the clock of the host by default', async () => {
    const sandbox = machineSandboxOf(source);
    const counted = machineSandboxOf(source, () => 12);

    await Effect.runPromise(sandbox.reserve);
    const unit = sandbox.unit();
    const runs = [unit.evaluate(fits, {}, evaluation), unit.evaluate(overflows, {}, evaluation)];
    unit.close();

    expect(runs).toMatchObject([
      { ran: 'answered', text: String(16 * 1024 * 1024) },
      { ran: 'exhausted', limit: 'memory' },
    ]);
    expect(sandbox.clock).toBe(hostClock);
    expect(counted.clock()).toBe(12);
    expect(hostClock()).toBeGreaterThan(0);
  });

  it('opens a context on an instance of 64 MiB for each group of filters, read against the clock of the host by default', async () => {
    const sandbox = filterSandboxOf(source);

    const session = await sandbox.session(() => evaluation);
    const [fitting, overflowing] = [session.define(fits), session.define(overflows)];
    const frozen = await session.freeze();
    const runs = [await fitting(argumentTextOf(null), evaluation), await overflowing(argumentTextOf(null), evaluation)];
    session.close();

    expect(runs).toMatchObject([
      { ran: 'answered', text: String(16 * 1024 * 1024) },
      { ran: 'exhausted', limit: 'memory' },
    ]);
    expect([frozen, sandbox.clock]).toEqual([undefined, hostClock]);
  });
});

describe.each(sourcesUnderTest)('the answers of the sandbox on the $name source to probes', ({ source }) => {
  it('answers each expression as JSON, or names how it ended', async () => {
    expect(await sandboxAnswers(source, ['typeof eval', 'Date.now()', 'null.x', '0 / 0'])).toEqual([
      '"undefined"',
      '0',
      "raised: TypeError: cannot read property 'x' of null",
      'unfit: The answer holds NaN at $, which JSON cannot carry',
    ]);
  });
});

/** A clock that moves on a tenth of a second each time it is read, counting its reads. */
function tickingClock(): { readonly read: () => number; readonly reads: () => number } {
  const ticking = { at: 0, reads: 0 };
  return {
    read: () => {
      ticking.reads += 1;
      ticking.at += 100;
      return ticking.at;
    },
    reads: () => ticking.reads,
  };
}

const runningForever = "do:\n  - churn: { set: { churned: '${ (() => { for (;;) {} })() }' } }";

const runtimeError: unknown = expect.stringMatching(/\/errors\/runtime$/u);

describe.each(sourcesUnderTest)('the patience of a decision on the $name source', ({ source }) => {
  it.each([300, 1000])(
    'ends the expressions of an input that outlast a patience of %i ms as a runtime error, once the clock its machine reads has passed it',
    async (patience) => {
      const clock = tickingClock();
      const machine = machineSandboxOf(source, clock.read);
      await Effect.runPromise(machine.reserve);

      const ended = decidedOnce(machine, runningForever, evaluatedAt, patience);

      expect(ended.outcome).toMatchObject({ kind: 'raised', error: { type: runtimeError, status: 500 } });
      expect(clock.reads()).toBe(patience / 100 + 2);
    },
  );
});
