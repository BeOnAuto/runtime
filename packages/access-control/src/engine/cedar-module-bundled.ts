import { Schema } from 'effect';

import type { CedarModuleSource } from './cedar.ts';

type ModuleConstructor = new (bytes: never) => WebAssembly.Module;

const WebAssemblySchema = Schema.Struct({
  Module: Schema.declare((value: unknown): value is ModuleConstructor => typeof value === 'function'),
});

const webAssembly = Schema.decodeUnknownSync(WebAssemblySchema)(Reflect.get(globalThis, 'WebAssembly'));

export const notCompiledByTheBundler = 'The module of the bundle is not Cedar’s WebAssembly as the bundler compiled it';

function compiledIn(imported: unknown): WebAssembly.Module {
  const compiled: unknown = Reflect.get(new Object(imported), 'default');
  if (!(compiled instanceof webAssembly.Module)) {
    throw new Error(notCompiledByTheBundler);
  }
  return compiled;
}

export function cedarModuleBundled(imported: () => Promise<unknown>): CedarModuleSource {
  let compiled: Promise<WebAssembly.Module> | undefined;
  return () => {
    compiled ??= imported().then(compiledIn);
    return compiled;
  };
}
