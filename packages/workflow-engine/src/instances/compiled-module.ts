import * as releaseSync from '@jitl/quickjs-wasmfile-release-sync';
import { dependencyFileOf, type ShippedFile, type ShippedFiles, type ShippedRoots } from '@on.auto/operations';
import { Schema } from 'effect';
import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSSyncVariant } from 'quickjs-emscripten-core';

import type { SandboxInstance } from '../programs/sandbox-session.ts';
import type { SandboxModule } from './instance-source.ts';

export type Instantiated = Omit<SandboxInstance, 'release'>;

interface GrowingMemory {
  readonly buffer: ArrayBuffer;
  grow(pages: number): number;
  toFixedLengthBuffer(): ArrayBuffer;
  toResizableBuffer(): ArrayBuffer;
}

interface MemoryLimits {
  readonly initial: number;
  readonly maximum: number;
}

type MemoryConstructor = new (limits: MemoryLimits) => GrowingMemory;

type Compile = (bytes: Readonly<Uint8Array>) => Promise<WebAssembly.Module>;

interface Bounded {
  readonly memory: GrowingMemory;
  readonly refusedGrowth: () => boolean;
}

export const pageBytes = 65_536;

const enginePackage = '@on.auto/workflow-engine';

export const sandboxShippedRoots: ShippedRoots = { [enginePackage]: new URL('../../', import.meta.url) };

export const sandboxModuleFile: ShippedFile = dependencyFileOf(
  enginePackage,
  '@jitl/quickjs-wasmfile-release-sync',
  'dist/emscripten-module.wasm',
);

const initialPages = 256;

const attemptsOfOneGrowth = 3;

const WebAssemblySchema = Schema.Struct({
  Memory: Schema.declare((value: unknown): value is MemoryConstructor => typeof value === 'function'),
  compile: Schema.declare((value: unknown): value is Compile => typeof value === 'function'),
});

const webAssembly = Schema.decodeUnknownSync(WebAssemblySchema)(Reflect.get(globalThis, 'WebAssembly'));

const variant = Schema.decodeUnknownSync(
  Schema.declare((value: unknown): value is QuickJSSyncVariant => Reflect.get(new Object(value), 'type') === 'sync'),
)(releaseSync.default);

const compiledOnce = new WeakMap<SandboxModule, Promise<WebAssembly.Module>>();

function boundedMemory(memoryBytes: number): Bounded {
  const growth = { failedInARow: 0, refused: false };
  const memory = new webAssembly.Memory({ initial: initialPages, maximum: Math.ceil(memoryBytes / pageBytes) });
  const grow = memory.grow.bind(memory);
  Object.defineProperty(memory, 'grow', {
    value: (pages: number): number => {
      try {
        const grown = grow(pages);
        growth.failedInARow = 0;
        return grown;
      } catch (error) {
        growth.failedInARow += 1;
        growth.refused = growth.refused || growth.failedInARow === attemptsOfOneGrowth;
        throw error;
      }
    },
  });
  return { memory, refusedGrowth: () => growth.refused };
}

export async function sandboxModuleIn(shippedFiles: ShippedFiles): Promise<SandboxModule> {
  return { bytes: await shippedFiles.bytes(sandboxModuleFile) };
}

function compiledFrom(sandboxModule: SandboxModule): Promise<WebAssembly.Module> {
  if ('compiled' in sandboxModule) {
    return Promise.resolve(sandboxModule.compiled);
  }
  const compiled = compiledOnce.get(sandboxModule) ?? webAssembly.compile(sandboxModule.bytes);
  compiledOnce.set(sandboxModule, compiled);
  return compiled;
}

export async function instantiated(sandboxModule: SandboxModule, memoryBytes: number): Promise<Instantiated> {
  const { memory, refusedGrowth } = boundedMemory(memoryBytes);
  const wasmModule = await compiledFrom(sandboxModule);
  const module = await newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmModule, wasmMemory: memory }));
  return { module, memoryBytes, refusedGrowth };
}
