import { defineCommand, defineQuery } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook, type Harness } from '../testing/harness.ts';
import { uncheckedPages } from '../testing/page-ports.ts';
import { importCopied, importedReason } from './import-copy.ts';
import { playbookImportIn, playbookImportStepped } from './import-stream.ts';

const capabilities = [probe().capability];

const { createDefinition, getDefinition } = definitionOperationsFor(capabilities);

const toAlpha = toPlaybook('acme', 'alpha');

const DefinitionField = Schema.Struct({
  type: Schema.String,
  name: Schema.String,
  source: Schema.String,
  overview: Schema.optionalKey(Schema.String),
  paused: Schema.Boolean,
});

const MarkFields = { import_id: Schema.String, digest: Schema.String };

const StandingSchema = Schema.Struct({
  started: Schema.optionalKey(Schema.Struct(MarkFields)),
  finished: Schema.Boolean,
});

const copy = defineCommand('playbook', {
  name: 'copy_import',
  title: 'Copy import',
  description: 'Copies the definitions of a package as an import does.',
  route: { method: 'POST', path: '/copy-import' },
  inputSchema: Schema.Struct({ definitions: Schema.Array(DefinitionField), ...MarkFields }),
  outputSchema: StandingSchema,
  reasons: ['conflict', 'invalid_input', 'unavailable', 'not_found'],
  handle: ({ definitions, ...mark }) =>
    Effect.andThen(importCopied(capabilities, uncheckedPages)(definitions, mark), playbookImportIn),
});

const start = defineCommand('playbook', {
  name: 'start_import',
  title: 'Start import',
  description: 'Marks the start of an import.',
  route: { method: 'POST', path: '/start-import' },
  inputSchema: Schema.Struct(MarkFields),
  outputSchema: StandingSchema,
  reasons: ['conflict'],
  handle: (mark) => playbookImportStepped('start', mark),
});

const standing = defineQuery('playbook', {
  name: 'import_standing',
  title: 'Import standing',
  description: 'Reads how far an import went.',
  route: { method: 'GET', path: '/import' },
  inputSchema: Schema.Struct({ any: Schema.optionalKey(Schema.String) }),
  outputSchema: StandingSchema,
  reasons: [],
  handle: () => playbookImportIn,
});

interface Copied {
  readonly type: string;
  readonly name: string;
  readonly source: string;
  readonly overview?: string;
  readonly paused: boolean;
}

function probeOf(name: string, source = 'text'): Copied {
  return { type: 'probe', name, source, paused: false };
}

const fivePart = {
  definitions: [
    { ...probeOf('the-first'), overview: 'The first.' },
    ...['second', 'third', 'fourth', 'fifth'].map((name) => probeOf(`the-${name}`)),
  ],
};

const mark = { import_id: 'import-one', digest: 'digest-one' };

async function copied(definitions: Harness, written: readonly Copied[]) {
  await definitions.call(start, toAlpha(acmeAdmin, mark));
  return definitions.call(copy, toAlpha(acmeAdmin, { definitions: written, ...mark }));
}

const anotherPackage: unknown = expect.stringContaining('begun with another package');

describe('the copy of an import', () => {
  it('creates every definition paused, in the order of the package, and records that the import finished', async () => {
    const definitions = harness();

    expect(await copied(definitions, fivePart.definitions)).toEqual({
      status: 'succeeded',
      output: { started: mark, finished: true },
    });
    expect(
      await definitions.call(getDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'the-first' })),
    ).toMatchObject({ output: { status: 'paused', reason: importedReason, overview: 'The first.' } });
    expect(await definitions.call(standing, toAlpha(acmeAdmin))).toEqual({
      status: 'succeeded',
      output: { started: mark, finished: true },
    });
  });

  it('goes on from where a cut left it, with each definition once, and does nothing once finished', async () => {
    const definitions = harness();
    const cut = [...fivePart.definitions.slice(0, 2), probeOf('the-third', 'oops')];

    expect(await copied(definitions, cut)).toMatchObject({ reason: 'invalid_input' });
    expect(await copied(definitions, fivePart.definitions)).toMatchObject({ output: { finished: true } });
    expect(await copied(definitions, [probeOf('the-sixth')])).toMatchObject({ output: { finished: true } });
    expect(
      await definitions.call(getDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'the-sixth' })),
    ).toMatchObject({ status: 'rejected', reason: 'not_found' });
  });

  it('stops where the playbook holds a definition of the same name that is not the one in the package', async () => {
    const definitions = harness();
    await definitions.call(createDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'the-first', source: 'other' }));

    expect(await copied(definitions, fivePart.definitions)).toMatchObject({ status: 'rejected', reason: 'conflict' });
  });

  it('records no end of an import that never started', async () => {
    const definitions = harness();

    expect(await definitions.call(copy, toAlpha(acmeAdmin, { definitions: fivePart.definitions, ...mark }))).toEqual({
      status: 'succeeded',
      output: { finished: false },
    });
  });
});

describe('the start of an import', () => {
  it('is recorded once, and refuses another import or another package under the same import', async () => {
    const definitions = harness();

    expect(await definitions.call(start, toAlpha(acmeAdmin, mark))).toEqual({
      status: 'succeeded',
      output: { started: mark, finished: false },
    });
    expect(await definitions.call(start, toAlpha(acmeAdmin, mark))).toMatchObject({ status: 'succeeded' });
    expect(await definitions.call(start, toAlpha(acmeAdmin, { ...mark, import_id: 'import-two' }))).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'taken',
    });
    expect(await definitions.call(start, toAlpha(acmeAdmin, { ...mark, digest: 'digest-two' }))).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail: anotherPackage,
    });
  });
});
