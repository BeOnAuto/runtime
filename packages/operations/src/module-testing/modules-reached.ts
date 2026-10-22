import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

export interface ModulesReached {
  readonly files: readonly string[];
  readonly packages: readonly string[];
}

const runtimeImport = /^\s*(?:import|export)\s+(?!type\b)[^'"]*?\bfrom\s+'([^']+)'/gmu;

function importsOf(file: string): readonly string[] {
  return [...readFileSync(file, 'utf8').matchAll(runtimeImport)].map(
    ([, specifier = '']: readonly string[]) => specifier,
  );
}

export function modulesReachedFrom(folder: string, entry: string): ModulesReached {
  const files = new Set([entry]);
  const packages = new Set<string>();
  const pending = [entry];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    const specifiers = importsOf(join(folder, file));
    const unseen = specifiers
      .filter((specifier) => specifier.startsWith('.'))
      .map((relative) => normalize(join(dirname(file), relative)))
      .filter((imported) => !files.has(imported));
    for (const imported of unseen) {
      files.add(imported);
      pending.push(imported);
    }
    for (const name of specifiers.filter((specifier) => !specifier.startsWith('.'))) {
      packages.add(name);
    }
  }
  return { files: [...files].toSorted(), packages: [...packages].toSorted() };
}
