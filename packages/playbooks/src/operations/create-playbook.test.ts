import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { createPlaybook, retirePlaybook } from '../index.ts';
import { acmeAdmin, adaOfAcme } from '../testing/callers.ts';
import { firstMoment, harness, toOrg } from '../testing/harness.ts';

const toAcme = toOrg('acme');

function creating(input: object) {
  return harness().call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', ...input }));
}

describe('create_playbook', () => {
  it('is an org command at POST /playbooks that answers 201 and may meet conflict', () => {
    expect(createPlaybook.registration).toMatchObject({
      scope: 'org',
      kind: 'command',
      title: 'Create playbook',
      route: { method: 'POST', path: '/playbooks' },
      pathParameters: [],
      successStatus: 201,
      reasons: ['conflict'],
    });
  });

  it('creates an active playbook with who created it and when', async () => {
    const { call } = harness();

    expect(
      await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha', description: 'Answers sales' })),
    ).toStrictEqual({
      status: 'succeeded',
      output: {
        id: 'alpha',
        name: 'Alpha',
        description: 'Answers sales',
        status: 'active',
        created_at: firstMoment,
        created_by: { id: 'acme-admin', name: 'acme-admin' },
        updated_at: firstMoment,
      },
    });
  });

  it('names a person who created it by their id and their name', async () => {
    expect(await harness().call(createPlaybook, toAcme(adaOfAcme, { playbook: 'alpha', name: 'Alpha' }))).toMatchObject(
      {
        output: { created_by: { id: 'person:user_2ada', name: 'Ada Lovelace' } },
      },
    );
  });

  it('records the facts of the org in its playbooks stream', async () => {
    const { call, ledger } = harness();

    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' }));

    expect(ledger.streamNames()).toEqual(['org/acme/playbooks']);
  });
});

describe('the input of create_playbook', () => {
  it('gives a playbook an empty description when none is given', async () => {
    expect(await creating({ name: 'Alpha' })).toMatchObject({ output: { description: '' } });
  });

  it('has the name and the description trimmed', async () => {
    expect(await creating({ name: '  Alpha \n', description: '\t Sales  ' })).toMatchObject({
      output: { name: 'Alpha', description: 'Sales' },
    });
  });

  it('takes a name of 1 to 100 characters, not all whitespace, and a description of up to 2000', async () => {
    expect(await creating({ name: 'A', description: '' })).toMatchObject({ status: 'succeeded' });
    expect(await creating({ name: 'n'.repeat(100), description: 'd'.repeat(2000) })).toMatchObject({
      status: 'succeeded',
    });
    expect(await creating({ name: '   ', description: 'd'.repeat(2001) })).toMatchObject({
      reason: 'invalid_input',
      issues: [
        { pointer: '/name', detail: 'Expected a value with a length of at least 1' },
        { pointer: '/description', detail: 'Expected a value with a length of at most 2000' },
      ],
    });
    expect(await creating({ name: '', description: ` ${'d'.repeat(1999)} ` })).toMatchObject({
      issues: [
        { pointer: '/name', detail: 'Expected a value with a length of at least 1' },
        { pointer: '/description', detail: 'Expected a value with a length of at most 2000' },
      ],
    });
    expect(await creating({ name: 'n'.repeat(101) })).toMatchObject({
      issues: [{ pointer: '/name', detail: 'Expected a value with a length of at most 100' }],
    });
  });
});

describe('create_playbook rejecting input', () => {
  it('with a malformed id or a field the operation does not know', async () => {
    expect(await creating({ playbook: 'Alpha', name: 'Alpha', colour: 'red' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/colour' }, { pointer: '/playbook' }],
    });
  });
});

describe('the JSON Schema of the input of create_playbook', () => {
  it('tells an agent the limits of the name and the description', () => {
    expect(createPlaybook.registration.input.schema).toMatchObject({
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 100 },
        description: { type: 'string', maxLength: 2000 },
      },
      required: ['playbook', 'name'],
      additionalProperties: false,
    });
  });
});

describe('create_playbook rejecting with conflict', () => {
  it('meets an id held by an active or a retired playbook', async () => {
    const { call } = harness();
    const creatingAlpha = () => call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' }));
    await creatingAlpha();

    expect(await creatingAlpha()).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'There is already a playbook alpha in this org',
      kind: 'taken',
    });
    await call(retirePlaybook, toAcme(acmeAdmin, { playbook: 'alpha' }));
    expect(await creatingAlpha()).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The playbook alpha was retired, and a playbook id is never reused',
      kind: 'taken',
    });
  });

  it("meets the org's playbooks changed while it decided", async () => {
    const { dispatch, run } = harness();
    const creatingPlaybook = (playbook: string) =>
      dispatch(createPlaybook, toAcme(acmeAdmin, { playbook, name: playbook }));
    const bothAtOnce = Effect.all([creatingPlaybook('alpha'), creatingPlaybook('beta')], { concurrency: 'unbounded' });

    expect(await run(bothAtOnce)).toMatchObject([
      { status: 'succeeded', output: { id: 'alpha' } },
      { status: 'rejected', reason: 'conflict' },
    ]);
  });
});
