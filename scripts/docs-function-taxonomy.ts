import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  functionCategoryLabels,
  functionDescriptions,
  functionTypeOrder,
  functionResourceLabels,
} from '@on.auto/definitions';

export const functionTaxonomyDocument = `${JSON.stringify(
  {
    schema: 2,
    source: '@on.auto/definitions',
    functions: functionTypeOrder.map((type) => ({
      type,
      label: functionCategoryLabels[type],
      singular: functionResourceLabels[type].singular,
      plural: functionResourceLabels[type].plural,
      description: functionDescriptions[type],
    })),
  },
  null,
  2,
)}\n`;

export function writeFunctionTaxonomy(path: string): 'updated' | 'unchanged' {
  if (existsSync(path) && readFileSync(path, 'utf8') === functionTaxonomyDocument) return 'unchanged';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, functionTaxonomyDocument);
  return 'updated';
}

export function checkFunctionTaxonomy(path: string): void {
  if (!existsSync(path) || readFileSync(path, 'utf8') !== functionTaxonomyDocument) {
    throw new Error(`Function taxonomy is missing or stale at ${path}. Run pnpm docs:taxonomy.`);
  }
}

export function runFunctionTaxonomy(commandArguments: readonly string[], path: string): void {
  if (commandArguments.length === 0) {
    writeFunctionTaxonomy(path);
  } else if (commandArguments.length === 1 && commandArguments[0] === '--check') {
    checkFunctionTaxonomy(path);
  } else {
    throw new Error('Usage: pnpm docs:taxonomy [--check]');
  }
}

if (import.meta.main) {
  runFunctionTaxonomy(process.argv.slice(2), resolve(import.meta.dirname, '../docs/assets/brain-functions.json'));
}
