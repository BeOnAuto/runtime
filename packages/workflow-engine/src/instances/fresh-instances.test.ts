import * as releaseSync from '@jitl/quickjs-wasmfile-release-sync';
import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { Schema } from 'effect';
import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSSyncVariant } from 'quickjs-emscripten-core';
import { describe, expect, it } from 'vitest';

import { expressionUnitOf } from '../programs/expression-units.ts';
import { threadStackBytes } from '../programs/sandbox-bounds.ts';
import { freshInstance, pageBytes } from './fresh-instances.ts';
import { instanceStock } from './instance-stock.ts';

const evaluation = { budget: 1_000_000, deadlineAt: Number.POSITIVE_INFINITY, moment: 0 };

function allocated(memoryBytes: number, megabytes: number): Promise<unknown> {
  return freshInstance(shippedFilesOnDisk, memoryBytes).then((instance) => {
    const unit = expressionUnitOf(() => instance, {
      stackBytes: threadStackBytes,
      mostAnswerBytes: 1024,
      clock: () => 0,
    });
    const run = unit.evaluate(
      `(() => { const kept = []; for (let index = 0; index < ${megabytes}; index++) kept.push("y".repeat(1048576) + index); return kept.length })()`,
      {},
      evaluation,
    );
    unit.close();
    return { run, refused: instance.refusedGrowth() };
  });
}

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
  '(() => { const kept: string[] = []; try { for (;;) kept.push("y".repeat(1048576) + kept.length); } catch { return kept.length; } })()';

async function mostKeptInRawMemory(memoryBytes: number): Promise<number> {
  const wasmMemory = new Memory({ initial: 256, maximum: memoryBytes / pageBytes });
  const module = await newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmMemory }));
  const runtime = module.newRuntime();
  const context = runtime.newContext();
  const most = context.getNumber(context.unwrapResult(context.evalCode(keepingStrings.replaceAll(': string[]', ''))));
  context.dispose();
  runtime.dispose();
  return most;
}

describe('a fresh instance', () => {
  it('holds whatever raw memory of the same maximum holds, since the glue retries a refused growth smaller', async () => {
    const memoryBytes = 64 * pageBytes * 16;
    const most = await mostKeptInRawMemory(memoryBytes);

    expect(most).toBeGreaterThan(54);
    expect(await allocated(memoryBytes, most)).toMatchObject({
      run: { ran: 'answered', text: String(most) },
      refused: false,
    });
    expect(await allocated(memoryBytes, most + 1)).toMatchObject({ run: { ran: 'exhausted', limit: 'memory' } });
  });

  it('grows its memory up to the maximum it was made with, and refuses to grow past it', async () => {
    expect(await allocated(64 * pageBytes * 16, 40)).toMatchObject({
      run: { ran: 'answered', text: '40' },
      refused: false,
    });
    expect(await allocated(64 * pageBytes * 16, 80)).toMatchObject({
      run: { ran: 'exhausted', limit: 'memory' },
      refused: true,
    });
  });

  it('shares nothing with another instance made from the same compiled module', async () => {
    const [first, second] = await Promise.all([
      freshInstance(shippedFilesOnDisk, pageBytes * 512),
      freshInstance(shippedFilesOnDisk, pageBytes * 512),
    ]);

    expect(first.module).not.toBe(second.module);
    expect([first.memoryBytes, second.memoryBytes]).toEqual([pageBytes * 512, pageBytes * 512]);
  });
});

describe('a stock of instances', () => {
  it('hands out a fresh instance of the memory asked for every time, preparing the next while the last is in use', async () => {
    const instances = instanceStock((memoryBytes) => freshInstance(shippedFilesOnDisk, memoryBytes));

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
