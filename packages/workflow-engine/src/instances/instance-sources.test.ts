import * as releaseSync from '@jitl/quickjs-wasmfile-release-sync';
import { Schema } from 'effect';
import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSSyncVariant } from 'quickjs-emscripten-core';
import { describe, expect, it } from 'vitest';

import { sourcesUnderTest } from '../pool-testing/test-pools.ts';
import { moduleRun, type ModuleRun } from '../programs/module-runs.ts';
import { threadStackBytes } from '../programs/sandbox-bounds.ts';
import type { SandboxInstance } from '../programs/sandbox-session.ts';
import { pageBytes } from './compiled-module.ts';
import { instanceStock, type InstanceSource } from './instance-source.ts';

const evaluation = { budget: 1_000_000, deadlineAt: Number.POSITIVE_INFINITY, moment: 0 };

const settings = { stackBytes: threadStackBytes, mostAnswerBytes: 1_048_576, clock: () => 0 };

const memoryBytes = 64 * pageBytes * 16;

const variant = Schema.decodeUnknownSync(
  Schema.declare((value: unknown): value is QuickJSSyncVariant => Reflect.get(new Object(value), 'type') === 'sync'),
)(releaseSync.default);

type MemoryConstructor = new (limits: { readonly initial: number; readonly maximum: number }) => object;

const { Memory } = Schema.decodeUnknownSync(
  Schema.Struct({
    Memory: Schema.declare((value: unknown): value is MemoryConstructor => typeof value === 'function'),
  }),
)(Reflect.get(globalThis, 'WebAssembly'));

const keepingStrings =
  '(() => { const kept = []; try { for (;;) kept.push("y".repeat(1048576) + kept.length); } catch { return kept.length; } })()';

async function mostKeptInRawMemory(bytes: number): Promise<number> {
  const wasmMemory = new Memory({ initial: 256, maximum: bytes / pageBytes });
  const module = await newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmMemory }));
  const runtime = module.newRuntime();
  const context = runtime.newContext();
  const most = context.getNumber(context.unwrapResult(context.evalCode(keepingStrings)));
  context.dispose();
  runtime.dispose();
  return most;
}

const mostKept = await mostKeptInRawMemory(memoryBytes);

function ranOn(instance: SandboxInstance, program: string): ModuleRun {
  return moduleRun(instance, settings, { source: program, entry: 'default', arguments: [], evaluation });
}

async function ran(source: InstanceSource, program: string): Promise<ModuleRun> {
  return ranOn(await source(memoryBytes), program);
}

function keeping(megabytes: number): string {
  return `export default function () {\n  const kept = [];\n  for (let index = 0; index < ${megabytes}; index++) kept.push("y".repeat(1048576) + index);\n  return kept.length;\n}`;
}

describe.each(sourcesUnderTest)('an instance of the $name source', ({ source }) => {
  it('holds whatever raw memory of the same maximum holds, since the glue retries a refused growth smaller', async () => {
    const fitting = await source(memoryBytes);
    const holding = [ranOn(fitting, keeping(mostKept)), fitting.refusedGrowth()];
    const overflowing = await ran(source, keeping(mostKept + 1));

    expect(mostKept).toBeGreaterThan(54);
    expect(holding).toMatchObject([{ ran: 'answered', text: String(mostKept) }, false]);
    expect(overflowing).toMatchObject({ ran: 'exhausted', limit: 'memory' });
  });

  it('grows its memory up to the maximum it was made with, and refuses to grow past it', async () => {
    const fitting = await ran(source, keeping(40));
    const refusing = await source(memoryBytes);
    const overflowing = ranOn(refusing, keeping(80));

    expect([fitting, overflowing, refusing.refusedGrowth()]).toMatchObject([
      { ran: 'answered', text: '40' },
      { ran: 'exhausted', limit: 'memory' },
      true,
    ]);
  });

  it('holds the maximum each unit asks for', async () => {
    const [small, large] = [await source(pageBytes * 512), await source(pageBytes * 1024)];

    expect([small.memoryBytes, large.memoryBytes]).toEqual([pageBytes * 512, pageBytes * 1024]);
  });
});

describe.each(sourcesUnderTest)('the unit after one that exhausted the memory of the $name source', ({ source }) => {
  it('holds the whole of its memory, as the first unit did', async () => {
    expect([await ran(source, keeping(mostKept + 1)), await ran(source, keeping(mostKept))]).toMatchObject([
      { ran: 'exhausted', limit: 'memory' },
      { ran: 'answered', text: String(mostKept) },
    ]);
  });
});

describe.each(sourcesUnderTest)('a stock of instances of the $name source', ({ source }) => {
  it('hands out an instance of the memory asked for every time, preparing the next while the last is in use', async () => {
    const instances = instanceStock(source);

    const [first, second, other] = [
      await instances(pageBytes * 512),
      await instances(pageBytes * 512),
      await instances(pageBytes * 1024),
    ];

    expect(first.module).not.toBe(second.module);
    expect([first.memoryBytes, second.memoryBytes, other.memoryBytes]).toEqual([
      pageBytes * 512,
      pageBytes * 512,
      pageBytes * 1024,
    ]);
  });
});
