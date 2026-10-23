import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { sandboxModuleOnDisk } from '../pool-testing/test-pools.ts';
import { moduleRun } from '../programs/module-runs.ts';
import { threadStackBytes, unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import type { SandboxInstance } from '../programs/sandbox-session.ts';
import { sandboxModuleFile } from './compiled-module.ts';
import { freshInstances } from './fresh-instances.ts';

type Compile = (bytes: Readonly<Uint8Array>) => Promise<WebAssembly.Module>;

const { compile } = Schema.decodeUnknownSync(
  Schema.Struct({ compile: Schema.declare((value: unknown): value is Compile => typeof value === 'function') }),
)(Reflect.get(globalThis, 'WebAssembly'));

const settings = { stackBytes: threadStackBytes, mostAnswerBytes: 1024, clock: () => 0 };

const evaluation = { budget: 1_000_000, deadlineAt: Number.POSITIVE_INFINITY, moment: 0 };

function answerOn(instance: SandboxInstance): unknown {
  return moduleRun(instance, settings, {
    source: 'export default function () {\n  return 6 * 7;\n}',
    entry: 'default',
    arguments: [],
    evaluation,
  });
}

describe('the fresh source of instances', () => {
  it('makes a fresh instance for every unit, from the one module it compiled, even after a unit gave one back', async () => {
    const source = freshInstances(sandboxModuleOnDisk);
    const [first, second] = await Promise.all([source(unitMemoryBytes), source(unitMemoryBytes)]);
    first.release(true);
    const third = await source(unitMemoryBytes);

    expect(new Set([first.module, second.module, third.module]).size).toBe(3);
  });

  it('makes its instances of a module the host compiled already, as of the bytes it compiles itself', async () => {
    const compiled = await compile(await shippedFilesOnDisk.bytes(sandboxModuleFile));
    const source = freshInstances({ compiled });
    const [first, second] = [await source(unitMemoryBytes), await source(unitMemoryBytes)];

    expect([answerOn(first), answerOn(second)]).toMatchObject([
      { ran: 'answered', text: '42' },
      { ran: 'answered', text: '42' },
    ]);
    expect(first.module).not.toBe(second.module);
  });
});
