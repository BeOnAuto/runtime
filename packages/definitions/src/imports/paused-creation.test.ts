import { defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { definitionChangeOf } from '../registry/definition-changes.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook, type Harness } from '../testing/harness.ts';
import { uncheckedPages } from '../testing/page-ports.ts';
import { definitionCreatedPaused } from './paused-creation.ts';

const capabilities = [probe().capability];

const { createDefinition, getDefinition, resumeDefinition, runDefinition } = definitionOperationsFor(capabilities);

const createPaused = defineCommand('playbook', {
  name: 'create_paused',
  title: 'Create paused',
  description: 'Creates a definition paused, as an import does.',
  route: { method: 'POST', path: '/paused' },
  inputSchema: Schema.Struct({
    type: Schema.String,
    name: Schema.String,
    source: Schema.String,
    reason: Schema.optionalKey(Schema.String),
  }),
  outputSchema: Schema.Struct({ status: Schema.String, reason: Schema.optionalKey(Schema.String) }),
  reasons: ['not_found', 'invalid_input', 'conflict', 'unavailable'],
  handle: (input) =>
    Effect.map(definitionCreatedPaused(capabilities, uncheckedPages)(input), ({ status, reason }) => ({
      status,
      ...(reason === undefined ? {} : { reason }),
    })),
});

const toAlpha = toPlaybook('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

const plain = { type: 'probe', name: 'plain' };

async function recordsOfTheDefinitions({ ledger, run }: Harness) {
  const { records } = await run(
    Effect.orDie(
      ledger.service.readRecorded(
        { org: 'acme', playbook: 'alpha' },
        { kind: 'everything' },
        { order: 'asc', limit: 20 },
      ),
    ),
  );
  return records.filter(({ stream }) => stream.endsWith('definitions/probe'));
}

const imported = { ...plain, source: 'text', reason: 'Imported, waiting for its owner' };

const anId: unknown = expect.stringMatching(/^[0-9a-f-]{36}$/u);

describe('a definition created paused', () => {
  it('is paused from the fact that creates it, by its creator and for the reason given, and starts no run', async () => {
    const definitions = harness();
    const created = await definitions.call(createPaused, toAlpha(acmeAdmin, imported));
    const read = await definitions.call(getDefinition, toAlpha(acmeAdmin, plain));
    const ran = await definitions.call(runDefinition, toAlpha(acmeAdmin, plain));

    expect(created).toEqual({ status: 'succeeded', output: { status: 'paused', reason: imported.reason } });
    expect(read).toMatchObject({
      status: 'succeeded',
      output: {
        status: 'paused',
        paused_at: firstMoment,
        paused_by: { id: 'acme-admin', name: 'acme-admin' },
        reason: imported.reason,
      },
    });
    expect(ran).toMatchObject({ status: 'rejected', reason: 'conflict', kind: 'paused' });
  });

  it('is recorded as one creation that says it is paused, which a host applies as paused before it activates', async () => {
    const definitions = harness();
    await definitions.call(createPaused, toAlpha(acmeAdmin, imported));
    const records = await recordsOfTheDefinitions(definitions);

    expect(records.map(({ type, data }) => [type, data])).toEqual([
      [
        'definition_created',
        {
          content: { source: 'text' },
          created_by: { id: 'acme-admin', name: 'acme-admin' },
          definition_id: anId,
          paused: { reason: imported.reason },
          playbook: 'alpha',
        },
      ],
    ]);
    expect(definitionChangeOf(records[0])).toEqual({
      kind: 'created_paused',
      name: 'plain',
      version: 1,
      triggers: [],
      at: firstMoment,
    });
  });
});

describe('a definition created paused, held for its owner', () => {
  it('may hold a blank, gives no reason when none is given, and once resumed runs as any resumed definition', async () => {
    const definitions = harness();
    const created = await definitions.call(
      createPaused,
      toAlpha(acmeAdmin, { ...plain, source: 'channel AUTO_BLANK_CHANNEL' }),
    );
    await definitions.call(resumeDefinition, toAlpha(acmeAdmin, plain), later);

    expect(created).toEqual({ status: 'succeeded', output: { status: 'paused' } });
    expect(await definitions.call(getDefinition, toAlpha(acmeAdmin, plain))).toMatchObject({
      status: 'succeeded',
      output: { status: 'active', version: 1 },
    });
    expect(await definitions.call(runDefinition, toAlpha(acmeAdmin, plain), later)).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded' },
    });
  });

  it('is refused as any creation is, by a name already taken', async () => {
    const definitions = harness();
    await definitions.call(createDefinition, toAlpha(acmeAdmin, { ...plain, source: 'text' }));

    expect(await definitions.call(createPaused, toAlpha(acmeAdmin, { ...plain, source: 'text' }))).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'taken',
    });
  });
});
