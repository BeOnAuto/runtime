import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type Capability } from '../capability/capability.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import { echoDeclaration } from '../testing/capabilities/echo.ts';
import { firstMoment } from '../testing/harness.ts';
import { keptArmOfText } from '../testing/kept-documents.ts';
import { definitionOf, listedDefinitionOf } from './answered-definitions.ts';

const document = JSON.stringify({ greeting: 'Hi', description: 'Greets', notes: 'n'.repeat(3000) });

function readingOnce(): { readonly capability: Capability; readonly reads: () => number } {
  const reading = defineCapability({
    ...echoDeclaration,
    parse: () => Effect.succeed({ greeting: 'Hi' }),
    summarize: (parsed) => ({ ...echoDeclaration.summarize(parsed), warnings: ['Found on reading'] }),
  });
  let reads = 0;
  return {
    capability: {
      ...reading,
      prepare: (source, stripped) => {
        reads += 1;
        return reading.prepare(source, stripped);
      },
    },
    reads: () => reads,
  };
}

const stored: StoredDefinition = {
  name: 'greeter',
  version: 1,
  status: 'active',
  source: { kept: keptArmOfText(document) },
  warnings: ['A warning of the parser that saved it'],
  created_at: firstMoment,
  created_by: { id: 'acme-admin', name: 'acme-admin' },
  updated_at: firstMoment,
};

describe('the warnings of a definition whose document its playbook keeps outside its fact, listed', () => {
  it('are those found when its document was last read here, known by its digest, or else those it was saved with, with no read of the store', async () => {
    const { capability, reads } = readingOnce();

    const before = await Effect.runPromise(listedDefinitionOf(capability, stored));
    await Effect.runPromise(definitionOf(capability, stored, { source: document }));
    const after = await Effect.runPromise(listedDefinitionOf(capability, stored));

    expect([before.warnings, after.warnings]).toEqual([
      ['A warning of the parser that saved it'],
      ['Found on reading'],
    ]);
    expect(reads()).toBe(1);
  });
});
