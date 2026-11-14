import type { ShippedFiles } from '@on.auto/shipped-files';
import { Schema } from 'effect';

import { cedarModuleFile } from '../files/access-control-files.ts';
import type { CedarModuleSource } from './cedar.ts';

type Compile = (bytes: Readonly<Uint8Array>) => Promise<WebAssembly.Module>;

const WebAssemblySchema = Schema.Struct({
  compile: Schema.declare((value: unknown): value is Compile => typeof value === 'function'),
});

const webAssembly = Schema.decodeUnknownSync(WebAssemblySchema)(Reflect.get(globalThis, 'WebAssembly'));

const compiledOnce = new WeakMap<ShippedFiles, Promise<WebAssembly.Module>>();

export function cedarModuleIn(files: ShippedFiles): CedarModuleSource {
  return () => {
    const compiled =
      compiledOnce.get(files) ??
      files.bytes(cedarModuleFile).then((bytes: Readonly<Uint8Array>) => webAssembly.compile(bytes));
    compiledOnce.set(files, compiled);
    return compiled;
  };
}
