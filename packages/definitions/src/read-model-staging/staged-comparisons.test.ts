import { Effect, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ReadFromTheReadModel } from '../read-model-reads/read-model-definitions.ts';
import { capturedLogs } from '../read-model-testing/captured-logs.ts';
import { aSavedGreeting } from '../read-model-testing/saved-greeting.ts';
import type { RegisteredDefinition } from '../registry/definition-registry.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { usersCompared } from '../used-by/users-of-a-definition.ts';
import { registeredCompared } from './staged-definitions.ts';
import { readsCompared, triggersSinceCompared } from './staged-reads.ts';

const stored: RegisteredDefinition = {
  name: 'greet',
  version: 1,
  status: 'active',
  source: { inline: 'x' },
  created_at: '2026-10-01T09:00:00.000Z',
  created_by: { id: 'acme-admin', name: 'acme-admin' },
  updated_at: '2026-10-01T09:00:00.000Z',
};

const noneToday = new Map<string, RegisteredDefinition>().get('greet');

const noneInTheReadModel = new Map<string, { readonly stored: RegisteredDefinition }>().get('greet');

const weekly = { type: 'workflow', name: 'weekly', relation: 'reads' } as const;

describe('a read of a definition compared with the read model', () => {
  it('names the users of a definition as differing when either path finds another', () => {
    expect([usersCompared([weekly], [weekly]), usersCompared([weekly], [])]).toEqual([
      { outcome: 'matched', differing: [] },
      { outcome: 'mismatched', differing: ['used_by'] },
    ]);
  });

  it('names a definition that only one of them holds as its presence, and else the fields that differ', () => {
    expect([
      registeredCompared(noneToday, noneInTheReadModel),
      registeredCompared(stored, noneInTheReadModel),
      registeredCompared(noneToday, { stored }),
      registeredCompared({ ...stored, version: 2 }, { stored }),
    ]).toEqual([
      { outcome: 'matched', differing: [] },
      { outcome: 'mismatched', differing: ['presence'] },
      { outcome: 'mismatched', differing: ['presence'] },
      { outcome: 'mismatched', differing: ['version'] },
    ]);
  });

  it('of get_definition names a list entry that would not answer the warnings of the open, with no ledger to read', async () => {
    const { today, candidate } = await aSavedGreeting();
    const compared = (other: ReadFromTheReadModel) => Effect.runPromise(readsCompared(echo, today, other));

    expect([
      await compared(candidate),
      await compared({ ...candidate, definition: { ...candidate.definition, warnings: ['Another warning'] } }),
    ]).toEqual([
      { outcome: 'matched', differing: [] },
      { outcome: 'mismatched', differing: ['definition.warnings', 'remembered_warnings'] },
    ]);
  });
});

describe('the trigger point of a definition compared with the read model', () => {
  it('of the trigger point today answered, against the save the row names, logged and never failing', async () => {
    const logs = capturedLogs();
    await Effect.runPromise(
      Effect.all([
        triggersSinceCompared('echo', 'save-1', 'save-1'),
        triggersSinceCompared('echo', 'save-1', 'save-2'),
      ]).pipe(Effect.provide(Logger.layer([logs.logger]))),
    );

    expect(
      logs.logged().map(({ annotations }) => [annotations['read'], annotations['outcome'], annotations['differing']]),
    ).toEqual([
      ['triggers_since', 'matched', ''],
      ['triggers_since', 'mismatched', 'triggers_since'],
    ]);
  });
});
