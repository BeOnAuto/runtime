import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from 'vitest';

import type { BuildPlaybook } from '../build-testing/build-playbook.ts';
import { scratchDirectory } from '../testing/scratch.ts';
import { uploadCandidate } from '../trainer/candidate-upload.ts';
import type { Recipe } from './scripted-recipes.ts';

export type CandidateName =
  | 'visits-last'
  | 'visits-wide'
  | 'visits-narrow'
  | 'visits-even'
  | 'visits-mean'
  | 'visits-observed-mean'
  | 'visits-week'
  | 'visits-many-features'
  | 'visits-steady'
  | 'visits-not-a-number'
  | 'visits-extra-input'
  | 'visits-whole-numbers'
  | 'visits-allocating'
  | 'orders-last'
  | 'totals-run-rate'
  | 'not-a-model';

const visits: Omit<Recipe, 'recipe'> = { steps: 2, low: 1, high: 1, features: 0, given: 0, totals: false };

const recipes: Readonly<Record<Exclude<CandidateName, 'not-a-model'>, Recipe>> = {
  'visits-last': { ...visits, recipe: 'last' },
  'visits-wide': { ...visits, recipe: 'last', low: 100, high: 100 },
  'visits-narrow': { ...visits, recipe: 'last', low: 0, high: 0 },
  'visits-even': { ...visits, recipe: 'last', low: 3, high: 3 },
  'visits-mean': { ...visits, recipe: 'mean', low: 2, high: 2 },
  'visits-observed-mean': { ...visits, recipe: 'observed-mean', low: 2, high: 2 },
  'visits-week': { ...visits, recipe: 'last', length: 7 },
  'visits-many-features': { ...visits, recipe: 'mean', low: 2, high: 2, features: 40, given: 8 },
  'visits-steady': { ...visits, recipe: 'mean', low: 5, high: 5 },
  'visits-not-a-number': { ...visits, recipe: 'not-a-number' },
  'visits-extra-input': { ...visits, recipe: 'last', extra: ['extra'] },
  'visits-whole-numbers': { ...visits, recipe: 'whole-numbers' },
  'visits-allocating': { ...visits, recipe: 'allocating' },
  'orders-last': { ...visits, recipe: 'last', steps: 4, low: 2, high: 2, features: 2, given: 1 },
  'totals-run-rate': { ...visits, recipe: 'run-rate', steps: 1, low: 0.8, high: 1.2, totals: true },
};

const notAModel = 'This is text that says it is a model, and it is not one.\n';

export function candidateBytes(name: CandidateName): Readonly<Uint8Array> {
  return new TextEncoder().encode(name === 'not-a-model' ? notAModel : JSON.stringify(recipes[name]));
}

export function candidateSha256(name: CandidateName): string {
  return createHash('sha256').update(candidateBytes(name)).digest('hex');
}

export function candidateFile(name: CandidateName): string {
  const path = join(scratchDirectory(), `${name}.scripted`);
  writeFileSync(path, candidateBytes(name));
  return path;
}

export async function uploaded(playbook: BuildPlaybook, build: string, names: readonly CandidateName[]): Promise<void> {
  const [first, ...rest] = names;
  if (first === undefined) {
    return;
  }
  const upload = uploadCandidate(playbook.test.ports);
  expect(await playbook.send(upload, { run_id: build }, candidateBytes(first))).toMatchObject({ status: 'succeeded' });
  await uploaded(playbook, build, rest);
}
