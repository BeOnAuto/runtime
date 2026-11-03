import { playbookCallerOf } from '@on.auto/operations';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineStartVersion } from '../index.ts';
import { acmeAdmin, acmeReader, adaOfAcme } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook, type Harness } from '../testing/harness.ts';
import { relayedId, settledAt, withHandOn } from '../testing/relaying.ts';

const operations = definitionOperationsFor([echo, probe().capability]);

const { createDefinition, getDefinition, listDefinitions, pauseDefinition, retireDefinition, runDefinition } =
  operations;

const startVersion = defineStartVersion([echo, probe().capability]);

const toAlpha = toPlaybook('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

const muchLater = '2026-11-20T08:00:00.000Z';

const plain = { type: 'probe', name: 'plain' };

const pausingPlain = toAlpha(adaOfAcme, { ...plain, reason: 'The quarter is being closed' });

const pausedPlain = {
  type: 'probe',
  name: 'plain',
  version: 1,
  status: 'paused',
  media_type: 'text/plain',
  created_at: firstMoment,
  created_by: { id: 'acme-admin', name: 'acme-admin' },
  updated_at: firstMoment,
  paused_at: later,
  paused_by: { id: 'person:user_2ada', name: 'Ada Lovelace' },
  reason: 'The quarter is being closed',
  source: 'text',
};

async function withPlain() {
  const definitions = harness();
  await definitions.call(createDefinition, toAlpha(acmeAdmin, { ...plain, source: 'text' }));
  return definitions;
}

async function definitionRecords({ ledger, run }: Harness) {
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

describe('pause_definition', () => {
  it('is a playbook command at POST /definitions/{type}/{name}/pause that a repeat records nothing of', () => {
    expect(pauseDefinition.registration).toMatchObject({
      scope: 'playbook',
      kind: 'command',
      title: 'Pause definition',
      route: { method: 'POST', path: '/definitions/{type}/{name}/pause' },
      pathParameters: ['type', 'name'],
      successStatus: 200,
      repeatable: true,
      irreversible: false,
      reasons: ['not_found', 'conflict'],
    });
  });

  it('pauses a definition at its version and its last change, recording who paused it, when and why', async () => {
    const definitions = await withPlain();

    expect(await definitions.call(pauseDefinition, pausingPlain, later)).toStrictEqual({
      status: 'succeeded',
      output: pausedPlain,
    });
    expect((await definitionRecords(definitions)).at(-1)).toMatchObject({
      type: 'definition_paused',
      data: { paused_by: pausedPlain.paused_by, reason: 'The quarter is being closed' },
      context: { by: 'person:user_2ada', at: later, definitionVersion: 1 },
    });
  });

  it('keeps no reason when none is given', async () => {
    const { call } = await withPlain();

    const paused = await call(pauseDefinition, toAlpha(acmeAdmin, plain), later);

    expect(paused).toMatchObject({
      status: 'succeeded',
      output: { status: 'paused', paused_by: { id: 'acme-admin', name: 'acme-admin' } },
    });
    expect(paused).not.toHaveProperty('output.reason');
  });
});

describe('pause_definition repeated', () => {
  it('succeeds and records nothing for a definition already paused, keeping who paused it first and why', async () => {
    const definitions = await withPlain();
    await definitions.call(pauseDefinition, pausingPlain, later);

    expect(await definitions.call(pauseDefinition, toAlpha(acmeAdmin, plain), muchLater)).toStrictEqual({
      status: 'succeeded',
      output: pausedPlain,
    });
    expect((await definitionRecords(definitions)).map(({ type }) => type)).toEqual([
      'definition_created',
      'definition_paused',
    ]);
  });
});

describe('a paused definition', () => {
  it('is read and listed as paused, with who paused it, when and why', async () => {
    const { call } = await withPlain();
    await call(pauseDefinition, pausingPlain, later);

    expect(await call(getDefinition, toAlpha(acmeReader, plain))).toStrictEqual({
      status: 'succeeded',
      output: pausedPlain,
    });
    expect(await call(listDefinitions, toAlpha(acmeReader, { type: 'probe' }))).toMatchObject({
      status: 'succeeded',
      output: {
        definitions: [{ name: 'plain', status: 'paused', paused_at: later, paused_by: pausedPlain.paused_by }],
      },
    });
  });

  it('stays paused through an update, which saves a new version and keeps who paused it, when and why', async () => {
    const { call } = await withPlain();
    await call(pauseDefinition, pausingPlain, later);

    expect(
      await call(operations.updateDefinition, toAlpha(acmeAdmin, { ...plain, source: 'other' }), muchLater),
    ).toMatchObject({
      status: 'succeeded',
      output: { version: 2, status: 'paused', paused_at: later, reason: 'The quarter is being closed' },
    });
  });
});

describe('a paused definition asked to run', () => {
  it('leaves a definition that starts no run, by hand or by its triggers, in the runtime’s words', async () => {
    const { call } = await withPlain();
    await call(pauseDefinition, pausingPlain);
    const theRefusal = {
      status: 'rejected',
      reason: 'conflict',
      detail: 'The probe definition plain is paused and starts no runs until it is resumed',
      kind: 'paused',
    };

    expect(await call(runDefinition, toAlpha(acmeAdmin, plain))).toEqual(theRefusal);
    expect(
      await call(
        startVersion,
        toAlpha(playbookCallerOf({ org: 'acme', playbook: 'alpha' }), {
          ...plain,
          version: 1,
          input: {},
          run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
        }),
      ),
    ).toEqual(theRefusal);
  });
});

describe('pause_definition refusing', () => {
  it('is refused for a retired definition, in the words of retirement', async () => {
    const { call } = await withPlain();
    await call(retireDefinition, toAlpha(acmeAdmin, plain));

    expect(await call(pauseDefinition, pausingPlain)).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The probe definition plain is retired and can no longer be paused or resumed',
      kind: 'retired',
    });
  });

  it('is refused for a definition the playbook does not have, and to a caller that may only read', async () => {
    const { call } = await withPlain();

    expect(await call(pauseDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'plain' }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no echo definition plain in this playbook',
    });
    expect(await call(pauseDefinition, toAlpha(acmeReader, plain))).toMatchObject({
      status: 'rejected',
      reason: 'forbidden',
    });
  });

  it('refuses a reason that is blank or longer than 1,024 characters', async () => {
    const { call } = await withPlain();

    expect([
      await call(pauseDefinition, toAlpha(acmeAdmin, { ...plain, reason: '   ' })),
      await call(pauseDefinition, toAlpha(acmeAdmin, { ...plain, reason: 'x'.repeat(1025) })),
    ]).toMatchObject([
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/reason' }] },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/reason' }] },
    ]);
  });
});

describe('a run already going when its definition is paused', () => {
  it('finishes as it would have', async () => {
    const { running, settling, reading, call, pauseDefinition: pausing } = await withHandOn();
    await running();
    await call(pausing, toAlpha(acmeAdmin, { type: 'relay', name: 'hand-on' }));

    expect(Result.isSuccess(await settling({ status: 'succeeded', output: 'handed on' }))).toBe(true);
    expect(await reading()).toMatchObject({
      status: 'succeeded',
      output: { run_id: relayedId, status: 'succeeded', output: 'handed on', finished_at: settledAt },
    });
  });

  it('is answered as it stands to a start under its id, which starts nothing', async () => {
    const { call } = await withPlain();
    const startingOnce = toAlpha(playbookCallerOf({ org: 'acme', playbook: 'alpha' }), {
      ...plain,
      version: 1,
      input: {},
      run_id: relayedId,
    });
    const first = await call(startVersion, startingOnce);
    await call(pauseDefinition, pausingPlain, later);

    expect(await call(startVersion, startingOnce, later)).toStrictEqual(first);
  });
});
