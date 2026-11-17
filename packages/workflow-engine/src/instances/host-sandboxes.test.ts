import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

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
