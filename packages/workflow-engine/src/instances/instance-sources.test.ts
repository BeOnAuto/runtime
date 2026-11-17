import * as releaseSync from '@jitl/quickjs-wasmfile-release-sync';
import { importedWithoutAnAddress } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSSyncVariant } from 'quickjs-emscripten-core';
import { describe, expect, it } from 'vitest';

import { sandboxFilesOnDisk, sandboxModuleOnDisk, sourcesUnderTest } from '../pool-testing/test-pools.ts';
import { expressionUnitOf } from '../programs/expression-units.ts';
import { moduleRun, type ModuleRun } from '../programs/module-runs.ts';
import { threadStackBytes, unitMemoryBytes, workerStackBytes } from '../programs/sandbox-bounds.ts';
import type { SandboxInstance } from '../programs/sandbox-session.ts';
import { pageBytes, sandboxModuleFile, sandboxShippedRoots } from './compiled-module.ts';
import { freshInstances } from './fresh-instances.ts';
import { type InstanceSource, instanceStock } from './instance-source.ts';
import { keptInstances } from './kept-instances.ts';

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

type Compile = (bytes: Readonly<Uint8Array>) => Promise<WebAssembly.Module>;

const { compile } = Schema.decodeUnknownSync(
  Schema.Struct({ compile: Schema.declare((value: unknown): value is Compile => typeof value === 'function') }),
)(Reflect.get(globalThis, 'WebAssembly'));

const settingsFreshInstances = { stackBytes: threadStackBytes, mostAnswerBytes: 1024, clock: () => 0 };

function answerOn(instance: SandboxInstance): unknown {
  return moduleRun(instance, settingsFreshInstances, {
    source: 'export default function () {\n  return 6 * 7;\n}',
    entry: 'default',
    arguments: [],
    evaluation,
  });
}

const settingsKeptInstances = { stackBytes: threadStackBytes, mostAnswerBytes: 1024, clock: () => 0 };

function ranOnKeptInstances(instance: SandboxInstance, body: string): unknown {
  return moduleRun(instance, settingsKeptInstances, {
    source: `export default function () {\n  ${body}\n}`,
    entry: 'default',
    arguments: [],
    evaluation,
  });
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

describe('the module of the sandbox', () => {
  it('loads where import.meta.url names no file, and names the root of the engine only when its files are read', async () => {
    const loaded = await importedWithoutAnAddress(new URL('./compiled-module.ts', import.meta.url));

    expect(Object.keys(loaded)).toContain('sandboxShippedRoots');
    expect(sandboxShippedRoots()).toEqual({ '@on.auto/workflow-engine': new URL('../../', import.meta.url) });
  });
});

describe('the fresh source of instances', () => {
  it('makes a fresh instance for every unit, from the one module it compiled, even after a unit gave one back', async () => {
    const source = freshInstances(sandboxModuleOnDisk);
    const [first, second] = await Promise.all([source(unitMemoryBytes), source(unitMemoryBytes)]);
    first.release(true);
    const third = await source(unitMemoryBytes);

    expect(new Set([first.module, second.module, third.module]).size).toBe(3);
  });

  it('makes its instances of a module the host compiled already, as of the bytes it compiles itself', async () => {
    const compiled = await compile(await sandboxFilesOnDisk.bytes(sandboxModuleFile));
    const source = freshInstances({ compiled });
    const [first, second] = [await source(unitMemoryBytes), await source(unitMemoryBytes)];

    expect([answerOn(first), answerOn(second)]).toMatchObject([
      { ran: 'answered', text: '42' },
      { ran: 'answered', text: '42' },
    ]);
    expect(first.module).not.toBe(second.module);
  });
});

describe('the kept source of instances', () => {
  it('lends the next unit of the same maximum the instance the last one gave back intact', async () => {
    const source = keptInstances(sandboxModuleOnDisk);
    const first = await source(unitMemoryBytes);
    ranOnKeptInstances(first, 'return 1;');

    const second = await source(unitMemoryBytes);
    const other = await source(pageBytes * 512);

    expect(second.module).toBe(first.module);
    expect(other.module).not.toBe(first.module);
  });

  it('lends a fresh instance after a unit whose instance refused to grow, or whose runtime broke', async () => {
    const source = keptInstances(sandboxModuleOnDisk);
    const refusing = await source(pageBytes * 256);
    const refused = ranOnKeptInstances(refusing, 'return "x".repeat(2 ** 25).length;');
    const afterRefusal = await source(pageBytes * 256);
    const breaking = await source(unitMemoryBytes);
    const deep = expressionUnitOf(() => breaking, { ...settingsKeptInstances, stackBytes: workerStackBytes });
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
    const source = keptInstances(sandboxModuleOnDisk);
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
