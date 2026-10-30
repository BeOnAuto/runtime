import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { onTestFinished } from 'vitest';

import type { InstalledPackages, ListedExtension } from '../../extensions/extension-loading.ts';

export interface ScratchPackage {
  readonly name: string;
  readonly module: string;
}

interface ScratchPackages {
  readonly packages: InstalledPackages;
  readonly folderOf: (name: string) => string;
}

export const besideTheRuntime = fileURLToPath(new URL('../../../node_modules/', import.meta.url));

export function scratchFolder(within: string = tmpdir()): string {
  const folder = mkdtempSync(join(within, 'auto-runtime-extension-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

export function manifestSource(name: string, provisions: readonly string[]): string {
  return `export const manifest = { name: '${name}', version: '1.0.0', provides: [${provisions.join(', ')}] };\n`;
}

export function scratchPackages(fixtures: readonly ScratchPackage[], within?: string): ScratchPackages {
  const root = scratchFolder(within);
  const folders = new Map(
    fixtures.map(({ name, module }, at) => {
      const folder = join(root, `package-${at}`);
      mkdirSync(folder);
      writeFileSync(join(folder, 'package.json'), JSON.stringify({ name, type: 'module' }));
      writeFileSync(join(folder, 'index.mjs'), module);
      return [name, folder];
    }),
  );
  const folderOf = (name: string): string => {
    const folder = folders.get(name);
    if (folder === undefined) {
      throw new Error(`Cannot find package '${name}'`);
    }
    return folder;
  };
  return {
    folderOf,
    packages: {
      imported: (name) => import(pathToFileURL(join(folderOf(name), 'index.mjs')).href),
      directoryOf: folderOf,
    },
  };
}

export function configured(...packages: readonly string[]): readonly ListedExtension[] {
  return packages.map((name) => ({ package: name, provenance: 'configured', ofTheRelease: false }));
}
