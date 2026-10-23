import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { describe, expect, it } from 'vitest';

import { expressionUnitOf } from '../programs/expression-units.ts';
import { moduleRun } from '../programs/module-runs.ts';
import { threadStackBytes, unitMemoryBytes, workerStackBytes } from '../programs/sandbox-bounds.ts';
import type { SandboxInstance } from '../programs/sandbox-session.ts';
import { pageBytes } from './compiled-module.ts';
import { keptInstances } from './kept-instances.ts';

const settings = { stackBytes: threadStackBytes, mostAnswerBytes: 1024, clock: () => 0 };

const evaluation = { budget: 1_000_000, deadlineAt: Number.POSITIVE_INFINITY, moment: 0 };

function ranOn(instance: SandboxInstance, body: string): unknown {
  return moduleRun(instance, settings, {
    source: `export default function () {\n  ${body}\n}`,
    entry: 'default',
    arguments: [],
    evaluation,
  });
}

describe('the kept source of instances', () => {
  it('lends the next unit of the same maximum the instance the last one gave back intact', async () => {
    const source = keptInstances(shippedFilesOnDisk);
    const first = await source(unitMemoryBytes);
    ranOn(first, 'return 1;');

    const second = await source(unitMemoryBytes);
    const other = await source(pageBytes * 512);

    expect(second.module).toBe(first.module);
    expect(other.module).not.toBe(first.module);
  });

  it('lends a fresh instance after a unit whose instance refused to grow, or whose runtime broke', async () => {
    const source = keptInstances(shippedFilesOnDisk);
    const refusing = await source(pageBytes * 256);
    const refused = ranOn(refusing, 'return "x".repeat(2 ** 25).length;');
    const afterRefusal = await source(pageBytes * 256);
    const breaking = await source(unitMemoryBytes);
    const deep = expressionUnitOf(() => breaking, { ...settings, stackBytes: workerStackBytes });
    const broke = deep.evaluate(
      '(() => { const down = (depth) => down(depth + 1); return down(0) })()',
      {},
      evaluation,
    );
    deep.close();
    const afterBreak = await source(unitMemoryBytes);

    expect([refused, broke]).toMatchObject([
      { ran: 'exhausted', limit: 'memory' },
      { ran: 'exhausted', limit: 'stack' },
    ]);
    expect(afterRefusal.module).not.toBe(refusing.module);
    expect(afterBreak.module).not.toBe(breaking.module);
  });

  it('keeps one instance for each maximum, and takes nothing back from a unit that gave its instance back before', async () => {
    const source = keptInstances(shippedFilesOnDisk);
    const [first, second] = [await source(unitMemoryBytes), await source(unitMemoryBytes)];
    first.release(true);
    second.release(true);
    const kept = await source(unitMemoryBytes);
    first.release(true);
    const after = await source(unitMemoryBytes);

    expect(kept.module).toBe(first.module);
    expect([after.module === first.module, after.module === second.module]).toEqual([false, false]);
  });
});
