import * as releaseSync from '@jitl/quickjs-wasmfile-release-sync';
import { Schema } from 'effect';
import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSSyncVariant } from 'quickjs-emscripten-core';

import type { SandboxInstance } from '../programs/sandbox-session.ts';
import type { SandboxFiles } from './instance-source.ts';

export type Instantiated = Omit<SandboxInstance, 'release'>;

interface GrowingMemory {
  readonly grow: (pages: number) => number;
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

export const sandboxModuleFile = new URL(import.meta.resolve('@jitl/quickjs-wasmfile-release-sync/wasm'));

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

const compiledThrough = new WeakMap<SandboxFiles, Promise<WebAssembly.Module>>();

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

function compiledFrom(files: SandboxFiles): Promise<WebAssembly.Module> {
  const compiled = compiledThrough.get(files) ?? files.bytes(sandboxModuleFile).then(webAssembly.compile);
  compiledThrough.set(files, compiled);
  return compiled;
}

export async function instantiated(files: SandboxFiles, memoryBytes: number): Promise<Instantiated> {
  const { memory, refusedGrowth } = boundedMemory(memoryBytes);
  const wasmModule = await compiledFrom(files);
  const module = await newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmModule, wasmMemory: memory }));
  return { module, memoryBytes, refusedGrowth };
}
