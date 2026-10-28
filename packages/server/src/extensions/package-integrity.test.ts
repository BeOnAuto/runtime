import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { integrityOf } from './package-integrity.ts';

function packageFolder(files: Readonly<Record<string, string>>): string {
  const folder = mkdtempSync(join(tmpdir(), 'auto-runtime-integrity-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(folder, path, '..'), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
  return folder;
}

function expectedIntegrity(files: readonly (readonly [string, string])[]): string {
  const hash = createHash('sha512');
  for (const [path, text] of files) {
    hash.update(`${path}\0${Buffer.byteLength(text)}\0${text}`);
  }
  return `sha512-${hash.digest('base64')}`;
}

describe('the integrity of an installed package', () => {
  it('is the SHA-512 of each file under its folder, by its path sorted as UTF-8 bytes, its length and its bytes, past node_modules', async () => {
    const folder = packageFolder({
      'package.json': '{"name":"@acme/models"}',
      'src/index.js': 'export const manifest = {};',
      'src/Zeta.js': 'export {};',
      'node_modules/dependency/index.js': 'never read',
    });

    expect(await integrityOf(folder)).toBe(
      expectedIntegrity([
        ['package.json', '{"name":"@acme/models"}'],
        ['src/Zeta.js', 'export {};'],
        ['src/index.js', 'export const manifest = {};'],
      ]),
    );
  });

  it('changes with any byte of a file or its name, and refuses a symbolic link it would not cover', async () => {
    const original = await integrityOf(packageFolder({ 'index.js': 'one' }));
    const linked = packageFolder({ 'index.js': 'one' });
    symlinkSync(join(linked, 'index.js'), join(linked, 'other.js'));

    expect([
      original === (await integrityOf(packageFolder({ 'index.js': 'two' }))),
      original === (await integrityOf(packageFolder({ 'main.js': 'one' }))),
    ]).toEqual([false, false]);
    await expect(integrityOf(linked)).rejects.toThrow(
      'The package holds a symbolic link at other.js, which its integrity does not cover',
    );
  });
});

describe('the dependencies an installed package bundles', () => {
  it('are covered, every file under node_modules/<name> for each name it bundles, and no other nested package is', async () => {
    const manifest = JSON.stringify({ name: '@acme/models', bundleDependencies: ['bundled', '@acme/inner'] });
    const files = (bundled: string, other: string): Readonly<Record<string, string>> => ({
      'package.json': manifest,
      'node_modules/bundled/index.js': bundled,
      'node_modules/bundled/node_modules/deeper/index.js': 'deeper',
      'node_modules/@acme/inner/index.js': 'inner',
      'node_modules/other/index.js': other,
    });
    const original = await integrityOf(packageFolder(files('one', 'one')));

    expect(original).toBe(
      expectedIntegrity([
        ['node_modules/@acme/inner/index.js', 'inner'],
        ['node_modules/bundled/index.js', 'one'],
        ['node_modules/bundled/node_modules/deeper/index.js', 'deeper'],
        ['package.json', manifest],
      ]),
    );
    expect([
      original === (await integrityOf(packageFolder(files('two', 'one')))),
      original === (await integrityOf(packageFolder(files('one', 'two')))),
    ]).toEqual([false, true]);
  });

  it('are read from bundledDependencies as from bundleDependencies, and as every dependency the package names when true', async () => {
    const manifest = JSON.stringify({
      name: '@acme/models',
      dependencies: { bundled: '1.0.0' },
      bundledDependencies: true,
    });

    expect(await integrityOf(packageFolder({ 'package.json': manifest, 'node_modules/bundled/index.js': 'one' }))).toBe(
      expectedIntegrity([
        ['node_modules/bundled/index.js', 'one'],
        ['package.json', manifest],
      ]),
    );
  });
});
