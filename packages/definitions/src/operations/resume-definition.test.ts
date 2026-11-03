import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin, adaOfAcme } from '../testing/callers.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook, type Harness } from '../testing/harness.ts';

const { createDefinition, pauseDefinition, resumeDefinition, retireDefinition, runDefinition } =
  definitionOperationsFor([probe().capability]);

const toAlpha = toPlaybook('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

const muchLater = '2026-11-20T08:00:00.000Z';

const plain = { type: 'probe', name: 'plain' };

const resumedPlain = {
  type: 'probe',
  name: 'plain',
  version: 1,
  status: 'active',
  media_type: 'text/plain',
  created_at: firstMoment,
  created_by: { id: 'acme-admin', name: 'acme-admin' },
  updated_at: firstMoment,
  source: 'text',
};

async function typesOfTheDefinitions({ ledger, run }: Harness) {
  const { records } = await run(
    Effect.orDie(
      ledger.service.readRecorded(
        { org: 'acme', playbook: 'alpha' },
        { kind: 'everything' },
        { order: 'asc', limit: 20 },
      ),
    ),
  );
  return records.filter(({ stream }) => stream.endsWith('definitions/probe')).map(({ type }) => type);
}

async function pausedPlain() {
  const definitions = harness();
  await definitions.call(createDefinition, toAlpha(acmeAdmin, { ...plain, source: 'text' }));
  await definitions.call(pauseDefinition, toAlpha(adaOfAcme, { ...plain, reason: 'Closing the quarter' }), later);
  return definitions;
}

describe('resume_definition', () => {
  it('is a playbook command at POST /definitions/{type}/{name}/resume that a repeat records nothing of', () => {
    expect(resumeDefinition.registration).toMatchObject({
      scope: 'playbook',
      kind: 'command',
      title: 'Resume definition',
      route: { method: 'POST', path: '/definitions/{type}/{name}/resume' },
      pathParameters: ['type', 'name'],
      successStatus: 200,
      repeatable: true,
      irreversible: false,
      reasons: ['not_found', 'conflict'],
    });
  });

  it('makes a paused definition active again at its version and its last change, forgetting who paused it, when and why', async () => {
    const { call } = await pausedPlain();

    expect(await call(resumeDefinition, toAlpha(acmeAdmin, plain), muchLater)).toStrictEqual({
      status: 'succeeded',
      output: resumedPlain,
    });
    expect(await call(runDefinition, toAlpha(acmeAdmin, plain), muchLater)).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded' },
    });
  });
});

describe('resume_definition repeated', () => {
  it('succeeds and records nothing for a definition that is not paused', async () => {
    const definitions = await pausedPlain();
    await definitions.call(resumeDefinition, toAlpha(acmeAdmin, plain), muchLater);

    expect(
      await definitions.call(resumeDefinition, toAlpha(acmeAdmin, plain), '2026-12-01T00:00:00.000Z'),
    ).toStrictEqual({ status: 'succeeded', output: resumedPlain });
    expect(await typesOfTheDefinitions(definitions)).toEqual([
      'definition_created',
      'definition_paused',
      'definition_resumed',
    ]);
  });

  it('is refused for a retired definition, and for one the playbook does not have', async () => {
    const { call } = await pausedPlain();
    await call(retireDefinition, toAlpha(acmeAdmin, plain), muchLater);

    expect([
      await call(resumeDefinition, toAlpha(acmeAdmin, plain)),
      await call(resumeDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'missing' })),
    ]).toEqual([
      {
        status: 'rejected',
        reason: 'conflict',
        detail: 'The probe definition plain is retired and can no longer be paused or resumed',
        kind: 'retired',
      },
      { status: 'rejected', reason: 'not_found', detail: 'There is no probe definition missing in this playbook' },
    ]);
  });
});

describe('a paused definition that is retired', () => {
  it('keeps no trace of its pause', async () => {
    const { call } = await pausedPlain();

    expect(await call(retireDefinition, toAlpha(acmeAdmin, plain), muchLater)).toStrictEqual({
      status: 'succeeded',
      output: { ...resumedPlain, status: 'retired', updated_at: muchLater, retired_at: muchLater },
    });
  });
});

describe('the plain language of pause_definition and resume_definition', () => {
  it('says the definition starts no runs until it is resumed, and that it can run again once it is', () => {
    const triggered = {
      ...resumedPlain,
      triggers: [{ kind: 'every', reference: '/schedule/every', milliseconds: 60_000 }],
    };

    expect([
      pauseDefinition.registration.plainLanguage?.outcome({ ...resumedPlain, status: 'paused' }, plain),
      resumeDefinition.registration.plainLanguage?.outcome(resumedPlain, plain),
      resumeDefinition.registration.plainLanguage?.outcome(triggered, plain),
    ]).toEqual([
      'Paused the probe “plain”. It starts no runs until it is resumed, and the runs already going finish.',
      'Resumed the probe “plain”. It can be run again.',
      'Resumed the probe “plain”. It can be run again, and its triggers start runs again from now, not for what came while it was paused.',
    ]);
  });

  it('names the definition it tried to pause or resume', () => {
    const attempts = [pauseDefinition, resumeDefinition].map(({ registration }) => [
      registration.plainLanguage?.attempt(plain),
      registration.plainLanguage?.attempt({}),
    ]);

    expect(attempts).toEqual([
      ['pause the probe “plain”', 'pause a probe'],
      ['resume the probe “plain”', 'resume a probe'],
    ]);
  });
});
