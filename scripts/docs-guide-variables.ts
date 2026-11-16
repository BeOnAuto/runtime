import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { defaultsTypedIn, markingFaultsOf, withDefaultsWritten } from '@on.auto/api';
import type { GuideVariables } from '@on.auto/definitions';

export const declaredByDefault: GuideVariables = {};

const regenerating = 'pnpm docs:guide-variables';

const guidePagesOfTheReference: ReadonlySet<string> = new Set(['template.md', 'triggers.md', 'events.md']);

function pagesIn(docs: string): readonly string[] {
  return readdirSync(docs, { recursive: true, withFileTypes: true })
    .filter(
      (entry: Readonly<Dirent>) =>
        entry.isFile() && entry.name.endsWith('.md') && !entry.parentPath.includes('.vitepress'),
    )
    .map((entry: Readonly<Dirent>) => relative(docs, join(entry.parentPath, entry.name)))
    .toSorted();
}

export function guidePagesIn(docs: string): readonly string[] {
  return [
    'concepts/terminology.md',
    ...readdirSync(join(docs, 'reference'))
      .filter((name) => name.endsWith('-format.md') || name.startsWith('render-') || guidePagesOfTheReference.has(name))
      .toSorted()
      .map((name) => `reference/${name}`),
  ];
}

function textOf(docs: string, page: string): string {
  return readFileSync(join(docs, page), 'utf8');
}

export function writeGuideVariables(docs: string, declared: GuideVariables): 'updated' | 'unchanged' {
  const written = pagesIn(docs).filter((page) => {
    const text = textOf(docs, page);
    const withDefaults = withDefaultsWritten(text, declared);
    if (withDefaults !== text) {
      writeFileSync(join(docs, page), withDefaults);
    }
    return withDefaults !== text;
  });
  return written.length === 0 ? 'unchanged' : 'updated';
}

export function checkGuideVariables(docs: string, declared: GuideVariables): void {
  const faults = pagesIn(docs).flatMap((page) =>
    markingFaultsOf(textOf(docs, page), declared).map((fault) => `${page}: ${fault}`),
  );
  const typed =
    faults.length > 0 ? [] : guidePagesIn(docs).flatMap((page) => defaultsTypedIn(page, textOf(docs, page), declared));
  const problems = [...faults, ...typed];
  if (problems.length > 0) {
    throw new Error(
      `The values the guides name are out of step with the server. ${regenerating} writes each default. ${problems.join(' ')}`,
    );
  }
}

export function runGuideVariables(commandArguments: readonly string[], docs: string, declared: GuideVariables): void {
  if (commandArguments.length === 0) {
    writeGuideVariables(docs, declared);
  } else if (commandArguments.length === 1 && commandArguments[0] === '--check') {
    checkGuideVariables(docs, declared);
  } else {
    throw new Error(`Usage: ${regenerating} [--check]`);
  }
}

if (import.meta.main) {
  runGuideVariables(process.argv.slice(2), resolve(import.meta.dirname, '../docs'), declaredByDefault);
}
