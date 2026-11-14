import { describe, expect, it } from 'vitest';

import { cedarOnDisk } from '../testing/access-testing.ts';
import { cedarModuleBundled, notCompiledByTheBundler } from './cedar-module-bundled.ts';

function countedImport(imported: () => Promise<unknown>): {
  readonly imported: () => Promise<unknown>;
  readonly imports: () => number;
} {
  const count = { imports: 0 };
  return {
    imported: () => {
      count.imports += 1;
      return imported();
    },
    imports: () => count.imports,
  };
}

describe('the engine, loaded from a bundle', () => {
  it('is the module the bundler compiled, imported once, on first use, however often it is asked for', async () => {
    const compiled = await cedarOnDisk();
    const counted = countedImport(() => Promise.resolve({ default: compiled }));
    const loading = cedarModuleBundled(counted.imported);

    expect(counted.imports()).toBe(0);
    const [first, second] = await Promise.all([loading(), loading()]);

    expect(first).toBe(compiled);
    expect(second).toBe(compiled);
    expect(counted.imports()).toBe(1);
  });

  it('is refused where the bundle hands its bytes, or anything but a compiled module, and goes on refusing', async () => {
    const bytes = countedImport(() => Promise.resolve({ default: new Uint8Array([0, 97, 115, 109]) }));
    const handedBytes = cedarModuleBundled(bytes.imported);
    const nothing = cedarModuleBundled(() => Promise.resolve({}));

    await expect(handedBytes()).rejects.toThrow(notCompiledByTheBundler);
    await expect(handedBytes()).rejects.toThrow(notCompiledByTheBundler);
    await expect(nothing()).rejects.toThrow(notCompiledByTheBundler);
    expect(bytes.imports()).toBe(1);
  });

  it('fails to load where its module cannot be imported', async () => {
    const loading = cedarModuleBundled(() => Promise.reject(new Error('no module of the bundle is Cedar')));

    await expect(loading()).rejects.toThrow('no module of the bundle is Cedar');
  });
});
