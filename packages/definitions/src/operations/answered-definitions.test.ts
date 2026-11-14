import { InvalidInput } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type Capability } from '../capability/capability.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { echo, echoDeclaration } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook } from '../testing/harness.ts';
import { listedDefinitionOf, mostSourcesKept } from './answered-definitions.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const savedEarlier = definitionOperationsFor([echo]);

const warnedWhenSaved = JSON.stringify({ greeting: 'Hi', warnings: ['A warning of the parser that saved it'] });

function readingWarnings(warnings: readonly string[]): Capability {
  return defineCapability({
    ...echoDeclaration,
    summarize: (document) => ({ ...echoDeclaration.summarize(document), warnings }),
  });
}

const noLongerParsed = defineCapability({
  ...echoDeclaration,
  parse: () => Effect.fail(new InvalidInput({ detail: 'The echo document is no longer read', issues: [] })),
});

async function savedWithAWarning() {
  const definitions = harness();
  await definitions.call(
    savedEarlier.createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greeter', source: warnedWhenSaved }),
  );
  return definitions;
}

function storedWith(source: string): StoredDefinition {
  return {
    name: 'greeter',
    definition_id: 'id-of-greeter',
    version: 1,
    status: 'active',
    source: { inline: source },
    warnings: ['A warning of the parser that saved it'],
    created_at: firstMoment,
    created_by: { id: 'acme-admin', name: 'acme-admin' },
    updated_at: firstMoment,
  };
}

function countingReads(capability: Capability): { readonly capability: Capability; readonly reads: () => number } {
  let reads = 0;
  return {
    capability: {
      ...capability,
      prepare: (source, stripped) => {
        reads += 1;
        return capability.prepare(source, stripped);
      },
    },
    reads: () => reads,
  };
}

describe('the warnings of a saved definition, when it is read', () => {
  it('are what the parser of this server finds in its document, not what the parser that saved it found', async () => {
    const { call } = await savedWithAWarning();
    const today = definitionOperationsFor([readingWarnings(['A warning of the parser of today'])]);

    expect([
      await call(today.getDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greeter' })),
      await call(today.listDefinitions, toAlpha(acmeAdmin, { type: 'echo' })),
    ]).toMatchObject([
      { status: 'succeeded', output: { warnings: ['A warning of the parser of today'] } },
      { status: 'succeeded', output: { definitions: [{ warnings: ['A warning of the parser of today'] }] } },
    ]);
  });

  it('are left out when the parser of this server finds none', async () => {
    const { call } = await savedWithAWarning();
    const today = definitionOperationsFor([readingWarnings([])]);

    const read = await call(today.getDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greeter' }));

    expect(read).toMatchObject({ status: 'succeeded', output: { name: 'greeter' } });
    expect(read).not.toHaveProperty('output.warnings');
  });

  it('are the ones it was saved with when this server no longer parses its document', async () => {
    const { call } = await savedWithAWarning();
    const today = definitionOperationsFor([noLongerParsed]);

    expect(await call(today.getDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greeter' }))).toMatchObject({
      status: 'succeeded',
      output: { warnings: ['A warning of the parser that saved it'] },
    });
  });
});

describe('the warnings read from a document', () => {
  it('are read once for each document, however often it is read', async () => {
    const { capability, reads } = countingReads(readingWarnings(['Read once']));
    const stored = storedWith(warnedWhenSaved);

    const read = await Effect.runPromise(
      Effect.all([listedDefinitionOf(capability, stored), listedDefinitionOf(capability, { ...stored, version: 2 })]),
    );

    expect(read.map(({ warnings }) => warnings)).toEqual([['Read once'], ['Read once']]);
    expect(reads()).toBe(1);
  });

  it(`are kept for at most ${mostSourcesKept} documents at once, and read again once forgotten`, async () => {
    const { capability, reads } = countingReads(readingWarnings([]));
    const documents = Array.from({ length: mostSourcesKept + 1 }, (_, index) =>
      JSON.stringify({ greeting: `Hi ${index}` }),
    );

    await Effect.runPromise(
      Effect.forEach([...documents, ...documents.slice(0, 1)], (source) =>
        listedDefinitionOf(capability, storedWith(source)),
      ),
    );

    expect(reads()).toBe(mostSourcesKept + 2);
  });
});
