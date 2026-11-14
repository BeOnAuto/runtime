import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { playbookOperationsOf } from '../index.ts';
import { pagesInMemory } from '../testing/playbook-pages.ts';

const recordedBeforeGoals = readFileSync(new URL('./operations-without-goals.json', import.meta.url), 'utf8');

describe('the playbook operations without a goals port', () => {
  it('answer the names, descriptions, schemas and routes they answered before goals, byte for byte', () => {
    const registrations = playbookOperationsOf(pagesInMemory()).map(({ registration }) => registration);

    expect(JSON.stringify(registrations)).toBe(JSON.stringify(JSON.parse(recordedBeforeGoals)));
  });
});
