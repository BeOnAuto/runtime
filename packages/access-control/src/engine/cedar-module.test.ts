import type { ShippedFiles } from '@on.auto/shipped-files';
import { shippedFilesInMemory } from '@on.auto/shipped-files/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { filesOnDisk } from '../testing/access-testing.ts';
import { cedarModuleIn } from './cedar-module.ts';

interface HostImport {
  readonly module: string;
  readonly name: string;
  readonly kind: string;
}

interface ModuleConstructor {
  readonly imports: (module: WebAssembly.Module) => readonly HostImport[];
}

const moduleConstructor = Schema.decodeUnknownSync(
  Schema.declare(
    (value: unknown): value is ModuleConstructor =>
      typeof value === 'function' && typeof Reflect.get(value, 'imports') === 'function',
  ),
)(Reflect.get(Reflect.get(globalThis, 'WebAssembly'), 'Module'));

function countingReads(files: ShippedFiles): { readonly files: ShippedFiles; readonly reads: () => number } {
  const read = { count: 0 };
  return {
    files: {
      ...files,
      bytes: (file) => {
        read.count += 1;
        return files.bytes(file);
      },
    },
    reads: () => read.count,
  };
}

describe('the engine, loaded in Node', () => {
  it('is compiled from the bytes of its file once for each reader of files, on first use', async () => {
    const counting = countingReads(filesOnDisk);
    const loading = cedarModuleIn(counting.files);

    expect(counting.reads()).toBe(0);
    const [first, second] = await Promise.all([loading(), cedarModuleIn(counting.files)()]);

    expect(first).toBe(second);
    expect(counting.reads()).toBe(1);
  });

  it('fails to load where its file cannot be read, and goes on failing', async () => {
    const loading = cedarModuleIn(shippedFilesInMemory({}));

    await expect(loading()).rejects.toThrow('No file is shipped at @on.auto/access-control/node_modules/');
    await expect(loading()).rejects.toThrow('No file is shipped at');
  });

  it('asks its host for nothing but turning values into JSON and back and reporting its own errors: no clock, no randomness, no file and no network', async () => {
    const imported = moduleConstructor.imports(await cedarModuleIn(filesOnDisk)());

    expect(imported.map(({ module, name, kind }) => `${module} ${kind} ${name}`)).toEqual([
      './cedar_wasm_bg.js function __wbg_parse_545d11396395fbbd',
      './cedar_wasm_bg.js function __wbg_stringify_a2c39d991e1bf91d',
      './cedar_wasm_bg.js function __wbg___wbindgen_throw_81fc77679af83bc6',
      './cedar_wasm_bg.js function __wbg_Error_2e59b1b37a9a34c3',
      './cedar_wasm_bg.js function __wbg___wbindgen_string_get_914df97fcfa788f2',
      './cedar_wasm_bg.js function __wbg___wbindgen_is_undefined_c0cca72b82b86f4d',
      './cedar_wasm_bg.js function __wbindgen_init_externref_table',
    ]);
  });
});
