import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { importedWithoutAnAddress } from './unaddressed-modules.ts';

const folder = mkdtempSync(join(tmpdir(), 'auto-runtime-unaddressed-modules-'));

afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

function moduleOf(name: string, lines: readonly string[]): URL {
  writeFileSync(join(folder, name), lines.join('\n'));
  return pathToFileURL(join(folder, name));
}

const madeOfItsAddress = [
  '(() => {',
  '  try {',
  "    return new URL('./beside.ts', import.meta.url).href;",
  '  } catch (error) {',
  '    return String(error);',
  '  }',
  '})()',
].join('\n');

moduleOf('inner.ts', ['export const inner: string = import.meta.url;']);

const outer = moduleOf('outer.ts', [
  `import { Schema } from '${import.meta.resolve('effect')}';`,
  'import seven from \'data:text/javascript,import "node:path"; export default 7;\';',
  "import { inner } from './inner.ts';",
  'export const addresses: readonly string[] = [import.meta.url, inner];',
  'export const fileName: string | undefined = import.meta.filename;',
  `export const madeHere: string = ${madeOfItsAddress};`,
  'export const decodes: string = typeof Schema.decodeUnknownSync;',
  'export const fromData: number = seven;',
]);

const early = moduleOf('early.ts', ["export const early: URL = new URL('./beside.ts', import.meta.url);"]);

describe('a module imported without an address', () => {
  it('and the modules it imports have an import.meta.url that names no file and is the base of no URL', async () => {
    const imported = await importedWithoutAnAddress(outer);

    expect(Object.keys(imported)).toEqual(['addresses', 'decodes', 'fileName', 'fromData', 'madeHere']);
    expect(Reflect.get(imported, 'addresses')).toEqual([
      expect.stringMatching(/^unaddressed:file/u),
      expect.stringMatching(/^unaddressed:file/u),
    ]);
    expect([Reflect.get(imported, 'fileName'), Reflect.get(imported, 'madeHere')]).toEqual([
      undefined,
      'TypeError: Invalid URL',
    ]);
  });

  it('takes a package of node_modules and a module of another scheme as they are', async () => {
    const imported = await importedWithoutAnAddress(outer);

    expect([Reflect.get(imported, 'decodes'), Reflect.get(imported, 'fromData')]).toEqual(['function', 7]);
  });

  it('fails to load when it makes a URL of its import.meta.url as it loads, as it would where that is no URL', async () => {
    await expect(importedWithoutAnAddress(early)).rejects.toThrow('Invalid URL');
  });
});
